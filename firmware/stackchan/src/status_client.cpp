#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include "event_chime.h"
#include "event_states.h"
#include "face_renderer.h"
#include "head_motion.h"
#include "status_message.h"
#include "firmware_version.h"

#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif

extern const uint8_t approvalSoundStart[] asm("_binary_assets_lol_enemy_missing_wav_start");
extern const uint8_t approvalSoundEnd[] asm("_binary_assets_lol_enemy_missing_wav_end");
extern const uint8_t completionSoundStart[] asm("_binary_assets_ios_payment_success_wav_start");
extern const uint8_t completionSoundEnd[] asm("_binary_assets_ios_payment_success_wav_end");

namespace {
WebSocketsClient socket;
FaceRenderer face;
HeadMotion head;
PresentationPolicy presentation;
EventChimePolicy approvalChime;
EventChimePolicy completionChime;
bool speakerReady = false;
uint32_t displayedCelebration = 0;
bool debugPage = false;
uint32_t lastTap = 0;
bool wifiConnected = false;
bool wifiConfigured = true;
bool socketStarted = false;
bool socketConnected = false;
bool protocolReady = false;
bool dirty = true;  // UI task only
uint32_t connectedAt = 0;
uint32_t lastWifiAttempt = 0;
uint32_t lastDraw = 0;
uint32_t eventCount = 0;
const EventState* currentEvent = nullptr;
const char* connectionLabel = "Wi-Fi connecting";
const char* origin = "-";

// Network state has one owner. Only immutable/static pointers cross this queue.
struct DisplayState {
  bool wifiConnected;
  bool protocolReady;
  uint32_t eventCount;
  const EventState* currentEvent;
  const char* connectionLabel;
  const char* origin;
  uint32_t ip;
  const char* presentationState;
  uint32_t celebrationGeneration;
  uint32_t approvalSoundGeneration;
};

QueueHandle_t displayQueue = nullptr;
DisplayState displayed = {false, false, 0, nullptr, "Wi-Fi connecting", "-", 0, "offline", 0, 0};

void publishDisplayState() {
  DisplayState state = {wifiConnected,
                        protocolReady,
                        eventCount,
                        currentEvent,
                        connectionLabel,
                        origin,
                        wifiConnected ? (uint32_t)WiFi.localIP() : 0,
                        presentation.state(),
                        presentation.celebrationGeneration(),
                        presentation.approvalSoundGeneration()};
  xQueueOverwrite(displayQueue, &state);
}

void networkTask(void*);

void setConnection(const char* label) {
  connectionLabel = label;
  Serial.printf("status-client connection=%s\n", label);
}

void updateApprovalSound() {
  const bool waiting = displayed.protocolReady && !strcmp(displayed.presentationState, "waiting");
  const auto step = approvalChime.next(waiting, displayed.approvalSoundGeneration);
  if (!speakerReady || step == ChimeStep::None) {
    return;
  }
  if (step == ChimeStep::Stop) {
    M5.Speaker.stop(0);
    Serial.println("approval-audio stopped");
    return;
  }
  const size_t soundBytes = approvalSoundEnd - approvalSoundStart;
  const bool queued = M5.Speaker.playWav(approvalSoundStart, soundBytes, 1, 0, true);
  Serial.printf("approval-audio cue=lol-enemy-missing generation=%lu queued=%d\n",
                (unsigned long)displayed.approvalSoundGeneration, queued);
}

void updateCompletionSound() {
  const bool completed = displayed.protocolReady && !strcmp(displayed.presentationState, "done");
  const auto step = completionChime.next(completed, displayed.celebrationGeneration);
  if (!speakerReady || step == ChimeStep::None) {
    return;
  }
  // A separate channel prevents a late completion stop from cancelling a new approval cue.
  if (step == ChimeStep::Stop) {
    M5.Speaker.stop(1);
    Serial.println("completion-audio stopped");
    return;
  }
  const size_t soundBytes = completionSoundEnd - completionSoundStart;
  const bool queued = M5.Speaker.playWav(completionSoundStart, soundBytes, 1, 1, true);
  Serial.printf("completion-audio cue=ios-payment-success generation=%lu queued=%d\n",
                (unsigned long)displayed.celebrationGeneration, queued);
}

void draw() {
  const auto& connectionLabel = displayed.connectionLabel;
  const auto& protocolReady = displayed.protocolReady;
  const auto& currentEvent = displayed.currentEvent;
  const auto& origin = displayed.origin;
  const auto& eventCount = displayed.eventCount;
  const auto& wifiConnected = displayed.wifiConnected;
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(16, 14);
  M5.Display.print("Agent Indicator");
  M5.Display.setCursor(16, 46);
  M5.Display.print(connectionLabel);
  const uint32_t rgb = protocolReady && currentEvent ? currentEvent->color : 0x64748b;
  M5.Display.fillRect(16, 79, 288, 5,
                      M5.Display.color565((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255));
  M5.Display.setTextSize(3);
  M5.Display.setCursor(16, 102);
  M5.Display.print(protocolReady ? displayed.presentationState : "Offline");
  M5.Display.setTextSize(1);
  M5.Display.setCursor(16, 153);
  M5.Display.printf("Last: %s", currentEvent ? currentEvent->state : "-");
  M5.Display.setCursor(16, 164);
  M5.Display.print(currentEvent ? currentEvent->event : "-");
  M5.Display.setCursor(16, 175);
  M5.Display.printf("Source: %s    Events: %lu", protocolReady ? origin : "-",
                    (unsigned long)eventCount);
  M5.Display.setCursor(16, 198);
  M5.Display.printf("Bridge: %s:%u", BRIDGE_HOST, BRIDGE_PORT);
  M5.Display.setCursor(16, 217);
  M5.Display.printf("IP: %s", wifiConnected ? IPAddress(displayed.ip).toString().c_str() : "-");
  M5.Display.setCursor(16, 231);
  M5.Display.printf("Firmware: %s", INDICATOR_FIRMWARE_VERSION);
}

void receiveMessage(uint8_t* payload, size_t length) {
  const auto decoded = decodeStatusMessage(payload, length, protocolReady);
  switch (decoded.kind) {
    case MessageKind::Hello:
      protocolReady = true;
      presentation.hello(decoded.at);
      currentEvent = nullptr;
      origin = "-";
      setConnection("Connected");
      Serial.println("status-client hello version=1");
      break;
    case MessageKind::ProtocolError:
      protocolReady = false;
      presentation.disconnect();
      setConnection("Protocol error");
      break;
    case MessageKind::Event:
      if (!presentation.receive(decoded.event, decoded.id, decoded.at)) {
        break;
      }
      currentEvent = decoded.event;
      origin = decoded.origin;
      ++eventCount;
      Serial.printf("status-client event=%s state=%s display=%s origin=%s count=%lu\n",
                    currentEvent->event, currentEvent->state, presentation.state(), origin,
                    (unsigned long)eventCount);
      break;
    case MessageKind::Ignored:
      break;
    default:
      Serial.printf("status-client rejected=%d\n", (int)decoded.kind);
      break;
  }
}

void onSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      socketConnected = true;
      protocolReady = false;
      presentation.disconnect();
      connectedAt = millis();
      setConnection("Awaiting hello");
      break;
    case WStype_DISCONNECTED:
      socketConnected = false;
      protocolReady = false;
      presentation.disconnect();
      setConnection(wifiConnected ? "Bridge connecting" : "Wi-Fi connecting");
      publishDisplayState();
      break;
    case WStype_TEXT:
      receiveMessage(payload, length);
      break;
    default:
      break;
  }
}
}  // namespace

void setup() {
  auto config = M5.config();
  config.fallback_board = m5::board_t::board_M5StackChan;
  config.internal_imu = false;
  config.internal_rtc = false;
  config.internal_mic = false;
  config.internal_spk = true;
  M5.begin(config);
  Serial.begin(115200);
  Serial.printf("firmware version=%s design=%s rise=20deg\n", INDICATOR_FIRMWARE_VERSION,
                FaceMotion::DESIGN);
  M5.Speaker.setVolume(EventChimePolicy::VOLUME);
  speakerReady = M5.Speaker.isEnabled() && M5.Speaker.begin();
  Serial.printf("approval-audio ready=%d volume=%u\n", speakerReady, EventChimePolicy::VOLUME);
  Serial.printf("completion-audio ready=%d channel=1\n", speakerReady);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  if (!face.begin()) {
    debugPage = true;
    Serial.println("face framebuffer allocation failed; using text page");
  }
  head.begin();
  displayQueue = xQueueCreate(1, sizeof(DisplayState));
  if (!displayQueue || xTaskCreatePinnedToCore(networkTask, "indicator-network", 8192, nullptr, 1,
                                               nullptr, 0) != pdPASS) {
    displayed.connectionLabel = "Network task failed";
    Serial.println("status-client network-task=failed");
  }
}

void loop() {
  M5.update();
  if (M5.Touch.getDetail().wasPressed() && millis() - lastTap > 300) {
    lastTap = millis();
    debugPage = face.available() ? !debugPage : true;
    dirty = true;
    Serial.printf("face page=%s\n", debugPage ? "details" : "expression");
  }
  DisplayState latest;
  if (displayQueue && xQueueReceive(displayQueue, &latest, 0) == pdTRUE) {
    dirty = dirty || latest.wifiConnected != displayed.wifiConnected ||
            latest.protocolReady != displayed.protocolReady ||
            latest.eventCount != displayed.eventCount ||
            latest.connectionLabel != displayed.connectionLabel || latest.ip != displayed.ip ||
            latest.currentEvent != displayed.currentEvent || latest.origin != displayed.origin;
    dirty = dirty || latest.presentationState != displayed.presentationState;
    displayed = latest;
  }
  updateApprovalSound();
  updateCompletionSound();
  head.update(displayed.protocolReady);
  const bool newCelebration = displayed.celebrationGeneration != displayedCelebration;
  face.update(millis(), displayed.protocolReady, displayed.presentationState, !debugPage,
              newCelebration && !strcmp(displayed.presentationState, "done"));
  displayedCelebration = displayed.celebrationGeneration;
  if (debugPage && dirty && millis() - lastDraw >= 100) {
    dirty = false;
    lastDraw = millis();
    draw();
  }
  delay(5);
}

namespace {
void networkTask(void*) {
  socket.onEvent(onSocketEvent);
  socket.setReconnectInterval(3000);
  socket.enableHeartbeat(15000, 3000, 2);
  Serial.printf("status-client bridge=%s:%u\n", BRIDGE_HOST, BRIDGE_PORT);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (USE_SAVED_WIFI) {
    wifi_config_t saved = {};
    wifiConfigured = esp_wifi_get_config(WIFI_IF_STA, &saved) == ESP_OK && saved.sta.ssid[0] != 0;
    memset(&saved, 0, sizeof(saved));
    Serial.printf("status-client saved-wifi-present=%d\n", wifiConfigured);
    if (wifiConfigured) {
      WiFi.begin();
    }
  } else {
    wifiConfigured = WIFI_SSID[0] != 0;
    if (wifiConfigured) {
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
  if (!wifiConfigured) {
    setConnection("Wi-Fi not configured");
  }
  lastWifiAttempt = millis();
  Serial.printf("status-client boot board=%d display=%dx%d saved-wifi=%d\n", (int)M5.getBoard(),
                M5.Display.width(), M5.Display.height(), USE_SAVED_WIFI);
  for (;;) {
    bool connected = WiFi.status() == WL_CONNECTED;
    if (connected != wifiConnected) {
      wifiConnected = connected;
      if (connected) {
        Serial.printf("status-client wifi-connected ip=%s\n", WiFi.localIP().toString().c_str());
        setConnection("Bridge connecting");
        if (!socketStarted) {
          socket.begin(BRIDGE_HOST, BRIDGE_PORT, "/status");
          socketStarted = true;
        }
      } else {
        socketConnected = false;
        protocolReady = false;
        presentation.disconnect();
        setConnection("Wi-Fi connecting");
        publishDisplayState();
        socket.disconnect();
      }
    }
    if (connected) {
      socket.loop();
      if (socketConnected && !protocolReady && millis() - connectedAt > 5000) {
        socket.disconnect();
      }
    } else if (wifiConfigured && millis() - lastWifiAttempt >= 15000) {
      lastWifiAttempt = millis();
      Serial.printf("status-client wifi-retry status=%d saved-wifi=%d\n", (int)WiFi.status(),
                    USE_SAVED_WIFI);
      WiFi.reconnect();
    }

    publishDisplayState();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}
}  // namespace
