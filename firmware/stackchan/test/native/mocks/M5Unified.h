#pragma once
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace fake {
struct State {
  uint32_t now = 0;
  uint32_t poweredAt = 0;
  uint32_t readyAfter = 2000;
  bool available = true;
  bool powered = false;
  bool writeOK = true;
  bool automatic = true;
  int factoryZero = 599;
  int level = 591;
  int raw = 591;
  int reads = 0;
  int powerCycles = 0;
  std::vector<bool> powerWrites;
  std::vector<int> moves;
  std::vector<int> writeAttempts;
  std::vector<std::string> settingsWrites;
  std::string input;
  std::string output;
};
inline State state;
inline bool responding() {
  return state.available && state.powered && state.now - state.poweredAt >= state.readyAfter;
}
}  // namespace fake

inline uint32_t millis() { return fake::state.now; }
inline constexpr int UART_NUM_1 = 1;
struct FakeSerial {
  int available() { return static_cast<int>(fake::state.input.size()); }
  char read() {
    const char value = fake::state.input.front();
    fake::state.input.erase(0, 1);
    return value;
  }
  void println(const char* value) { fake::state.output += std::string(value) + '\n'; }
  void printf(const char* format, ...) {
    char buffer[1024];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);
    fake::state.output += buffer;
  }
};
inline FakeSerial Serial;
