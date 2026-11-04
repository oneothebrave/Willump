#include <Arduino.h>
#include <HTTPClient.h>
#include <M5Unified.h>
#include <WiFi.h>
#include <driver/i2c.h>
#include <esp_camera.h>
#include <esp_err.h>
#include <esp_system.h>
#include <esp_wifi.h>

#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif

namespace {

constexpr uint8_t kAw9523Address = 0x58;
constexpr uint32_t kI2cFrequency = 400000;
constexpr uint8_t kAw9523Output1 = 0x03;
constexpr uint8_t kAw9523Config1 = 0x05;
constexpr uint8_t kCameraPowerBit = 1U << 0;
constexpr uint16_t kReceiverPort = 8790;
constexpr size_t kFrameWidth = 320;
constexpr size_t kFrameHeight = 240;
constexpr size_t kFrameBytes = kFrameWidth * kFrameHeight * 2;
constexpr uint8_t kFrameTarget = 10;
constexpr uint8_t kMaxFrameAttempts = 20;

bool setCameraPower(bool enabled) {
  uint8_t config = 0;
  uint8_t output = 0;
  if (!M5.In_I2C.readRegister(kAw9523Address, kAw9523Config1, &config, 1, kI2cFrequency) ||
      !M5.In_I2C.readRegister(kAw9523Address, kAw9523Output1, &output, 1, kI2cFrequency)) {
    return false;
  }

  config &= static_cast<uint8_t>(~kCameraPowerBit);
  if (enabled) {
    output |= kCameraPowerBit;
  } else {
    output &= static_cast<uint8_t>(~kCameraPowerBit);
  }
  return M5.In_I2C.writeRegister8(kAw9523Address, kAw9523Config1, config, kI2cFrequency) &&
         M5.In_I2C.writeRegister8(kAw9523Address, kAw9523Output1, output, kI2cFrequency);
}

camera_config_t makeCameraConfig() {
  camera_config_t config = {};
  config.pin_d0 = 39;
  config.pin_d1 = 40;
  config.pin_d2 = 41;
  config.pin_d3 = 42;
  config.pin_d4 = 15;
  config.pin_d5 = 16;
  config.pin_d6 = 48;
  config.pin_d7 = 47;
  config.pin_vsync = 46;
  config.pin_href = 38;
  config.pin_pclk = 45;
  config.pin_xclk = -1;
  config.pin_reset = -1;
  config.pin_pwdn = -1;
  config.pin_sccb_sda = -1;
  config.pin_sccb_scl = -1;
  config.sccb_i2c_port = I2C_NUM_1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_RGB565;
  config.frame_size = FRAMESIZE_QVGA;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  return config;
}

uint32_t frameChecksum(const camera_fb_t* frame) {
  uint32_t checksum = 2166136261U;
  for (size_t index = 0; index < frame->len; ++index) {
    checksum ^= frame->buf[index];
    checksum *= 16777619U;
  }
  return checksum;
}

void showStatus(const char* status, uint16_t color) {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(color, TFT_BLACK);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(12, 40);
  M5.Display.println("camera-stream");
  M5.Display.setTextSize(5);
  M5.Display.setCursor(12, 110);
  M5.Display.println(status);
}

}  // namespace

void setup() {
  auto config = M5.config();
  config.fallback_board = m5::board_t::board_M5StackChan;
  config.internal_imu = false;
  config.internal_rtc = false;
  config.internal_mic = false;
  config.internal_spk = false;
  M5.begin(config);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  showStatus("START", TFT_YELLOW);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  bool wifiConfigured = false;
  if (USE_SAVED_WIFI) {
    wifi_config_t saved = {};
    wifiConfigured = esp_wifi_get_config(WIFI_IF_STA, &saved) == ESP_OK && saved.sta.ssid[0] != 0;
    memset(&saved, 0, sizeof(saved));
    if (wifiConfigured) {
      WiFi.begin();
    }
  } else {
    wifiConfigured = WIFI_SSID[0] != 0;
    if (wifiConfigured) {
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }

  uint32_t wifiStartedAt = millis();
  while (wifiConfigured && WiFi.status() != WL_CONNECTED && millis() - wifiStartedAt < 20000) {
    delay(100);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("camera-stream wifi=failed configured=%d status=%d\n", wifiConfigured,
                  static_cast<int>(WiFi.status()));
    showStatus("FAIL", TFT_RED);
    return;
  }
  Serial.printf("camera-stream wifi=connected ip=%s receiver=%s:%u\n",
                WiFi.localIP().toString().c_str(), BRIDGE_HOST, kReceiverPort);

  bool cameraPowered = setCameraPower(true);
  bool cameraInitialized = false;
  uint8_t successfulFrames = 0;
  if (cameraPowered) {
    delay(200);
    camera_config_t cameraConfig = makeCameraConfig();
    esp_err_t initResult = esp_camera_init(&cameraConfig);
    cameraInitialized = initResult == ESP_OK;
    if (!cameraInitialized) {
      Serial.printf("camera-stream init=failed error=%s\n", esp_err_to_name(initResult));
    }
  } else {
    Serial.println("camera-stream power=failed");
  }

  String receiverUrl = String("http://") + BRIDGE_HOST + ":" + kReceiverPort + "/frame";
  char runId[9];
  snprintf(runId, sizeof(runId), "%08lx", static_cast<unsigned long>(esp_random()));
  uint8_t attempts = 0;
  bool sequenceConflict = false;
  while (cameraInitialized && successfulFrames < kFrameTarget && attempts < kMaxFrameAttempts &&
         !sequenceConflict) {
    ++attempts;
    uint8_t sequence = successfulFrames + 1;
    camera_fb_t* frame = esp_camera_fb_get();
    bool validFrame = frame != nullptr && frame->width == kFrameWidth &&
                      frame->height == kFrameHeight && frame->format == PIXFORMAT_RGB565 &&
                      frame->len == kFrameBytes;
    int responseStatus = 0;
    uint32_t checksum = 0;
    if (validFrame) {
      checksum = frameChecksum(frame);
      char checksumText[9];
      snprintf(checksumText, sizeof(checksumText), "%08lx", static_cast<unsigned long>(checksum));
      HTTPClient request;
      request.setConnectTimeout(2000);
      request.setTimeout(5000);
      request.begin(receiverUrl);
      request.addHeader("Content-Type", "application/octet-stream");
      request.addHeader("X-Willump-Width", "320");
      request.addHeader("X-Willump-Height", "240");
      request.addHeader("X-Willump-Format", "rgb565");
      request.addHeader("X-Willump-Run", runId);
      request.addHeader("X-Willump-Sequence", String(sequence));
      request.addHeader("X-Willump-Checksum", checksumText);
      responseStatus = request.sendRequest("POST", frame->buf, frame->len);
      request.end();
      if (responseStatus == 204) {
        ++successfulFrames;
      } else if (responseStatus == 409) {
        sequenceConflict = true;
      }
    }
    if (frame != nullptr) {
      esp_camera_fb_return(frame);
    }
    Serial.printf("camera-stream attempt=%u/%u frame=%u/%u valid=%d status=%d checksum=%08lx\n",
                  attempts, kMaxFrameAttempts, sequence, kFrameTarget, validFrame, responseStatus,
                  static_cast<unsigned long>(checksum));
    if (successfulFrames < kFrameTarget && attempts < kMaxFrameAttempts && !sequenceConflict) {
      delay(1000);
    }
  }

  bool powerOffSucceeded = setCameraPower(false);
  Serial.printf("camera-stream cleanup power-off=%d\n", powerOffSucceeded);
  esp_err_t deinitResult = cameraInitialized ? esp_camera_deinit() : ESP_OK;
  Serial.printf("camera-stream cleanup deinit=%s\n", esp_err_to_name(deinitResult));
  bool pass = successfulFrames == kFrameTarget && powerOffSucceeded && deinitResult == ESP_OK;
  Serial.printf("camera-stream result=%s sent=%u/%u attempts=%u/%u power-off=%d\n",
                pass ? "PASS" : "FAIL", successfulFrames, kFrameTarget, attempts,
                kMaxFrameAttempts, powerOffSucceeded);
  showStatus(pass ? "PASS" : "FAIL", pass ? TFT_GREEN : TFT_RED);
}

void loop() {
  delay(1000);
}
