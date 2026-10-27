#pragma once
#include <stdint.h>

enum class HeadInitStep { None, PowerOn, Probe };

// Bounded recovery for startup communication failures, independent of motion faults.
class HeadStartupPolicy {
 public:
  static constexpr int MAX_ATTEMPTS = 3;
  // Keep VM on across probes; resetting it after a timeout can prevent a slow boot.
  static constexpr uint32_t WARMUP_MS = 2000;
  static constexpr uint32_t RETRY_MS = 2000;

  void restart(uint32_t now) {
    attempts = 0;
    changedAt = now;
    phase = Phase::NeedPowerOn;
    retryPower = false;
  }

  HeadInitStep next(uint32_t now) {
    if (phase == Phase::RetryWait && now - changedAt >= RETRY_MS) {
      if (retryPower) {
        phase = Phase::NeedPowerOn;
      } else {
        ++attempts;
        phase = Phase::AwaitResult;
        return HeadInitStep::Probe;
      }
    }
    if (phase == Phase::NeedPowerOn) {
      ++attempts;
      phase = Phase::OnWait;
      changedAt = now;
      return HeadInitStep::PowerOn;
    }
    if (phase == Phase::OnWait && now - changedAt >= WARMUP_MS) {
      phase = Phase::AwaitResult;
      return HeadInitStep::Probe;
    }
    return HeadInitStep::None;
  }

  void succeeded() {
    phase = Phase::Ready;
  }

  void failed(uint32_t now, bool powerAvailable = true) {
    changedAt = now;
    retryPower = !powerAvailable;
    phase = attempts >= MAX_ATTEMPTS ? Phase::Failed : Phase::RetryWait;
  }

  bool exhausted() const {
    return phase == Phase::Failed;
  }

  int attemptCount() const {
    return attempts;
  }

 private:
  enum class Phase { Dormant, NeedPowerOn, OnWait, AwaitResult, RetryWait, Ready, Failed };
  Phase phase = Phase::Dormant;
  uint32_t changedAt = 0;
  int attempts = 0;
  bool retryPower = false;
};
