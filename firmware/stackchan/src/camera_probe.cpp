#include <Arduino.h>
#include <M5Unified.h>
#include <driver/i2c.h>
#include <esp_camera.h>
#include <esp_err.h>

// One-shot GC0308 bring-up on the existing M5 internal I2C bus.
// No network, audio, servo, or production behavior in this build.
namespace {

constexpr uint8_t kAw9523Address = 0x58;
constexpr uint32_t kI2cFrequency = 400000;
constexpr uint8_t kAw9523Output1 = 0x03;
constexpr uint8_t kAw9523Config1 = 0x05;
constexpr uint8_t kCameraPowerBit = 1U << 0;
constexpr size_t kFrameWidth = 320;
constexpr size_t kFrameHeight = 240;
constexpr size_t kFrameBytes = kFrameWidth * kFrameHeight * 2;

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

bool frameMatches(const camera_fb_t* frame) {
  return frame->width == kFrameWidth && frame->height == kFrameHeight &&
         frame->format == PIXFORMAT_RGB565 && frame->len == kFrameBytes;
}

uint32_t frameChecksum(const camera_fb_t* frame) {
  uint32_t checksum = 2166136261U;
  for (size_t index = 0; index < frame->len; ++index) {
    checksum ^= frame->buf[index];
    checksum *= 16777619U;
  }
  return checksum;
}

void showResult(bool pass) {
  M5.Display.setRotation(1);
  M5.Display.setBrightness(100);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(pass ? TFT_GREEN : TFT_RED, TFT_BLACK);
  M5.Display.setTextSize(4);
  M5.Display.setCursor(16, 30);
  M5.Display.print("camera-probe");
  M5.Display.setTextSize(6);
  M5.Display.setCursor(16, 100);
  M5.Display.print(pass ? "PASS" : "FAIL");
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

  bool pass = false;
  bool cameraInitialized = false;
  camera_fb_t* frame = nullptr;

  bool powerReady = setCameraPower(true);
  if (!powerReady) {
    Serial.println("camera-probe power=aw9523-io-failed");
  } else {
    delay(200);
    camera_config_t cameraConfig = makeCameraConfig();
    esp_err_t initResult = esp_camera_init(&cameraConfig);
    if (initResult != ESP_OK) {
      Serial.printf("camera-probe init=failed error=%s\n", esp_err_to_name(initResult));
    } else {
      cameraInitialized = true;
      frame = esp_camera_fb_get();
      if (frame == nullptr) {
        Serial.println("camera-probe frame=none");
      } else {
        pass = frameMatches(frame);
        Serial.printf("camera-probe width=%u height=%u format=%d len=%u checksum=0x%08lx\n",
                      static_cast<unsigned>(frame->width), static_cast<unsigned>(frame->height),
                      static_cast<int>(frame->format), static_cast<unsigned>(frame->len),
                      static_cast<unsigned long>(frameChecksum(frame)));
      }
    }
  }

  if (frame != nullptr) {
    esp_camera_fb_return(frame);
  }
  bool powerOffSucceeded = setCameraPower(false);
  esp_err_t deinitResult = cameraInitialized ? esp_camera_deinit() : ESP_OK;
  pass = pass && powerOffSucceeded && deinitResult == ESP_OK;
  Serial.printf("camera-probe cleanup power-off=%d deinit=%s\n", powerOffSucceeded,
                esp_err_to_name(deinitResult));

  showResult(pass);
  Serial.printf("camera-probe result=%s\n", pass ? "PASS" : "FAIL");
}

void loop() {
  delay(1000);
}
