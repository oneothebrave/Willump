#pragma once
#include <stdint.h>

enum class HeadInitStep { None, PowerOff, PowerOn, Probe };

// Bounded recovery for startup communication failures, independent of motion faults.
class HeadStartupPolicy {
 public:
  static constexpr int MAX_ATTEMPTS = 3;
  static constexpr uint32_t POWER_OFF_MS = 300;
  // This unit does not reply at 700ms after VM rises; allow a full boot before probing.
  static constexpr uint32_t WARMUP_MS = 2000;
  static constexpr uint32_t RETRY_MS = 1000;

  void restart(uint32_t now) {
    attempts = 0;
    changedAt = now;
    phase = Phase::NeedPowerOff;
  }

  HeadInitStep next(uint32_t now) {
    if (phase == Phase::RetryWait && now - changedAt >= RETRY_MS) {
      phase = Phase::NeedPowerOff;
    }
    if (phase == Phase::NeedPowerOff) {
      ++attempts;
      phase = Phase::OffWait;
      changedAt = now;
      return HeadInitStep::PowerOff;
    }
    if (phase == Phase::OffWait && now - changedAt >= POWER_OFF_MS) {
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

  void failed(uint32_t now) {
    changedAt = now;
    phase = attempts >= MAX_ATTEMPTS ? Phase::Failed : Phase::RetryWait;
  }

  bool exhausted() const {
    return phase == Phase::Failed;
  }

  int attemptCount() const {
    return attempts;
  }

 private:
  enum class Phase { Dormant, NeedPowerOff, OffWait, OnWait, AwaitResult, RetryWait, Ready, Failed };
  Phase phase = Phase::Dormant;
  uint32_t changedAt = 0;
  int attempts = 0;
};
