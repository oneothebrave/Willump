#pragma once
#include <M5Unified.h>
#include <Preferences.h>
#include <SCSCL.h>
#include <PY32IOExpander.hpp>
#include "head_policy.h"
#include "head_startup.h"
#include "firmware_version.h"

// Pitch only: no broadcast, yaw or factory calibration writes.
class HeadMotion {
  SCSCL bus;
  m5::PY32IOExpander_Class power;
  HeadPolicy policy;
  HeadStartupPolicy startup;
  int zero = 620;
  bool ready = false;
  bool configured = false;
  bool uartReady = false;
  bool connectedBefore = false;
  int lastPosition = -1;
  int lastError = 0;

  bool save(bool enabled, bool saveLevel = false) {
    Preferences prefs;
    if (!prefs.begin("indicator-head", false)) {
      return false;
    }
    bool ok = prefs.putBool("enabled", enabled) > 0;
    if (saveLevel) {
      ok = prefs.putInt("level", policy.horizontal()) > 0 && ok;
    }
    prefs.end();
    if (!ok) {
      Serial.println("head settings-save-failed");
    }
    return ok;
  }

  void failure(const char* reason, uint32_t now) {
    lastError = bus.getLastError();
    policy.failed(now);
    Serial.printf("head %s attempt=%d/%d fault=%d error=%d status=%d\n", reason,
                  policy.failureCount(), HeadPolicy::MAX_ATTEMPTS, policy.faulted(), lastError,
                  bus.getState());
  }

  void move(int pos, uint32_t now) {
    if (!policy.safe(pos)) {
      return;
    }
    const int current = bus.ReadPos(2);
    if (!HeadPolicy::valid(current) || bus.getState() != 0) {
      failure("read-failed", now);
      return;
    }
    // Servo executes the 900ms motion. Failures retry at most once per second.
    if (bus.WritePos(2, pos, 900, 0) != 1 || bus.getState() != 0) {
      failure("write-failed", now);
      return;
    }
    if (bus.EnableTorque(2, 1) != 1 || bus.getState() != 0) {
      failure("torque-failed", now);
      return;
    }
    policy.succeeded(pos);
    Serial.printf("head target=%d from=%d duration=900ms\n", pos, current);
  }

  void initialize(uint32_t now) {
    const auto step = startup.next(now);
    if (step == HeadInitStep::None) {
      return;
    }
    if (step == HeadInitStep::PowerOff) {
      // Establish an idle UART line before powering the servos back on.
      if (!uartReady) {
        uartReady = bus.begin(UART_NUM_1, 1000000, 6, 7);
        bus.IOTimeOut = 20;
      }
      if (!uartReady || !power.begin()) {
        startup.failed(now);
        Serial.printf("head init unavailable uart=%d attempt=%d/%d\n", uartReady,
                      startup.attemptCount(), HeadStartupPolicy::MAX_ATTEMPTS);
        return;
      }
      power.setDriveMode(0, false);
      if (!power.setDirection(0, true) || !power.setPullMode(0, m5::IOExpander_Base::pull_up) ||
          !power.digitalWrite(0, false)) {
        startup.failed(now);
        Serial.println("head init power-off-failed");
        return;
      }
      Serial.printf("head init attempt=%d/%d phase=power-off\n", startup.attemptCount(),
                    HeadStartupPolicy::MAX_ATTEMPTS);
    } else if (step == HeadInitStep::PowerOn) {
      if (!power.digitalWrite(0, true)) {
        startup.failed(now);
        Serial.println("head init power-on-failed");
        return;
      }
      Serial.println("head init phase=warming");
    } else if (step == HeadInitStep::Probe) {
      lastPosition = bus.ReadPos(2);
      lastError = bus.getLastError();
      const int status = bus.getState();
      if (!HeadPolicy::valid(lastPosition) || lastError || status) {
        startup.failed(now);
        Serial.printf("head init probe raw=%d error=%d status=%d attempt=%d/%d exhausted=%d\n",
                      lastPosition, lastError, status, startup.attemptCount(),
                      HeadStartupPolicy::MAX_ATTEMPTS, startup.exhausted());
        return;
      }
      startup.succeeded();
      policy.configure(policy.horizontal(), zero, policy.enabled());
      ready = true;
      Serial.printf("head ready raw=%d factory-zero=%d level=%d automatic=%d rise=20deg\n",
                    lastPosition, zero, policy.horizontal(), policy.enabled());
    }
  }

  void status() {
    if (ready) {
      lastPosition = bus.ReadPos(2);
      lastError = bus.getLastError();
    }
    Serial.printf("firmware version=%s head ready=%d level=%d target=%d raw=%d automatic=%d "
                  "fault=%d init-attempts=%d/%d init-exhausted=%d error=%d bridge=%d\n",
                  INDICATOR_FIRMWARE_VERSION, ready, policy.horizontal(), policy.targetPosition(),
                  lastPosition, policy.enabled(), policy.faulted(), startup.attemptCount(),
                  HeadStartupPolicy::MAX_ATTEMPTS, startup.exhausted(), lastError, connectedBefore);
  }

 public:
  void begin() {
    Preferences factory;
    if (factory.begin("servo", true)) {
      zero = factory.getInt("zero_pos_2", 620);
      factory.end();
    }
    if (!HeadPolicy::valid(zero)) {
      Serial.println("head invalid-factory-zero");
      return;
    }
    int level = -1;
    bool automatic = false;
    Preferences prefs;
    if (prefs.begin("indicator-head", true)) {
      level = prefs.getInt("level", -1);
      automatic = prefs.getBool("enabled", false);
      prefs.end();
    }
    policy.configure(level, zero, automatic);
    const bool calibrated = HeadPolicy::validCalibration(level, zero);
    configured = true;
    Serial.printf("head config factory-zero=%d level=%d automatic=%d calibrated=%d mode=bridge\n",
                  zero, policy.horizontal(), policy.enabled(), calibrated);
    // Position feedback is needed for manual calibration on a new device too.
    // HeadPolicy keeps all motion disabled until a valid level has been saved.
    startup.restart(millis());
  }

  void update(bool connected) {
    const uint32_t now = millis();
    if (connected != connectedBefore) {
      connectedBefore = connected;
      Serial.printf("head bridge=%s\n", connected ? "connected" : "disconnected");
      if (!ready && configured && startup.exhausted()) {
        startup.restart(now);
      }
    }
    while (Serial.available()) {
      const char command = Serial.read();
      if (command == 'v') {
        status();
      }
      if (command == 'h') {
        if (!ready) {
          Serial.println("head calibration-unavailable not-ready");
          continue;
        }
        const int pos = bus.ReadPos(2);
        if (!HeadPolicy::validCalibration(pos, zero)) {
          Serial.println("head calibration-out-of-range");
          continue;
        }
        policy.configure(pos, zero, false);
        if (save(false, true)) {
          Serial.printf("head horizontal-saved=%d\n", pos);
        }
      }
      if (command == 'u') {
        if (ready) {
          policy.manual(policy.horizontal() + 16, now);
        }
      }
      if (command == 'n') {
        if (ready) {
          policy.manual(policy.horizontal(), now);
        }
      }
      if (command == 'e' && policy.horizontal() >= 0) {
        policy.enable();
        save(true);
        if (!ready) {
          startup.restart(now);
        }
        Serial.println("head automatic-enabled mode=bridge rise=20deg");
      }
      if (command == 'x') {
        policy.disable();
        const bool off = ready && bus.EnableTorque(2, 0) == 1;
        save(false);
        Serial.printf("head disabled torque-off=%d\n", off);
      }
    }
    if (!ready) {
      if (configured) {
        initialize(now);
      }
      return;
    }
    const int pos = policy.next(now, connected);
    if (pos >= 0) {
      move(pos, now);
    }
  }
};
