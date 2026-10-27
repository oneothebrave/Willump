#pragma once
#include "M5Unified.h"
#include <stdexcept>

namespace m5 {
struct IOExpander_Base { enum gpio_pull_t { pull_up }; };
struct PY32IOExpander_Class {
  bool begin() { return true; }
  void setDriveMode(int, bool) {}
  bool setDirection(int, bool) { return true; }
  bool setPullMode(int, IOExpander_Base::gpio_pull_t) { return true; }
  bool digitalWrite(int pin, bool value) {
    if (pin != 0) throw std::runtime_error("non-servo power write");
    fake::state.powerWrites.push_back(value);
    if (value && !fake::state.powered) {
      fake::state.poweredAt = fake::state.now;
      ++fake::state.powerCycles;
    }
    fake::state.powered = value;
    return true;
  }
};
}  // namespace m5
