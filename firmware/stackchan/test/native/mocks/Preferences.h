#pragma once
#include "M5Unified.h"
#include <stdexcept>

class Preferences {
  std::string name;

 public:
  bool begin(const char* value, bool) { name = value; return true; }
  void end() {}
  int getInt(const char* key, int fallback) {
    if (name == "servo" && std::string(key) == "zero_pos_2") {
      return fake::state.factoryZero;
    }
    return fake::state.level < 0 ? fallback : fake::state.level;
  }
  bool getBool(const char*, bool) { return fake::state.automatic; }
  size_t putBool(const char* key, bool value) {
    if (name != "indicator-head") throw std::runtime_error("factory calibration write");
    fake::state.settingsWrites.push_back(name + ":" + key);
    fake::state.automatic = value;
    return 1;
  }
  size_t putInt(const char* key, int value) {
    if (name != "indicator-head") throw std::runtime_error("factory calibration write");
    fake::state.settingsWrites.push_back(name + ":" + key);
    fake::state.level = value;
    return sizeof(int);
  }
};
