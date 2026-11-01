#pragma once
#include <stddef.h>
#include <string.h>

// Keep these values in parity with src/domain/statusProtocol.ts.
// Header constants stay C++11-compatible: gnu++11 does not allow inline variables.
namespace ControlProtocol {
static constexpr int VERSION = 1;
static constexpr size_t MAX_COMMAND_ID_BYTES = 64;
static constexpr const char* HELLO_KIND = "device.hello";
static constexpr const char* COMMAND_KIND = "device.command";
static constexpr const char* ACK_KIND = "device.command.ack";
static constexpr const char* ACTION_POWEROFF = "poweroff";
}  // namespace ControlProtocol

struct ControlCommand {
  char id[ControlProtocol::MAX_COMMAND_ID_BYTES + 1] = {};
};

// Commands may be acknowledged again, but each accepted id executes at most once.
class ControlCommandHistory {
 public:
  static constexpr size_t CAPACITY = 4;

  bool contains(const char* id) const {
    for (size_t index = 0; index < count_; ++index) {
      if (!strcmp(ids_[index], id)) {
        return true;
      }
    }
    return false;
  }

  void remember(const char* id) {
    strncpy(ids_[next_], id, ControlProtocol::MAX_COMMAND_ID_BYTES);
    ids_[next_][ControlProtocol::MAX_COMMAND_ID_BYTES] = 0;
    next_ = (next_ + 1) % CAPACITY;
    if (count_ < CAPACITY) {
      ++count_;
    }
  }

 private:
  char ids_[CAPACITY][ControlProtocol::MAX_COMMAND_ID_BYTES + 1] = {};
  size_t next_ = 0;
  size_t count_ = 0;
};
