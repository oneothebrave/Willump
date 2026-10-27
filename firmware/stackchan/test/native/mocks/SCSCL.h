#pragma once
#include "M5Unified.h"
#include <stdexcept>

class SCSCL {
  int error = 0;
  void pitchOnly(int id) {
    if (id != 2) throw std::runtime_error("non-pitch servo access");
  }

 public:
  unsigned long IOTimeOut = 10;
  bool begin(int, int, int, int) { return true; }
  int ReadPos(int id) {
    pitchOnly(id);
    ++fake::state.reads;
    error = fake::responding() ? 0 : 1;
    return error ? -1 : fake::state.raw;
  }
  int getLastError() const { return error; }
  int getState() const { return 0; }
  int WritePos(int id, int value, int duration, int) {
    pitchOnly(id);
    if (duration != 900) throw std::runtime_error("unexpected motion duration");
    if (value < fake::state.level || value > fake::state.level + 64) {
      throw std::runtime_error("motion outside calibrated range");
    }
    fake::state.writeAttempts.push_back(value);
    error = fake::responding() && fake::state.writeOK ? 0 : 1;
    if (error) return 0;
    fake::state.moves.push_back(value);
    fake::state.raw = value;
    return 1;
  }
  int EnableTorque(int id, int) {
    pitchOnly(id);
    return fake::responding() ? 1 : 0;
  }
};
