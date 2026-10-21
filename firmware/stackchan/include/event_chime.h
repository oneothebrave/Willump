#pragma once
#include <stdint.h>

enum class ChimeStep { None, Play, Stop };

// Each notification owns a separate speaker channel and an instance of this policy.
// Playback runs in M5Unified's audio task; the UI only starts or cancels it.
class EventChimePolicy {
 public:
  static constexpr uint8_t VOLUME = 64;

  ChimeStep next(bool activeState, uint32_t generation) {
    const bool newEvent = generation != seenGeneration;
    seenGeneration = generation;

    if (!activeState) {
      const bool wasActive = active;
      active = false;
      return wasActive ? ChimeStep::Stop : ChimeStep::None;
    }

    if (newEvent) {
      active = true;
      return ChimeStep::Play;
    }

    return ChimeStep::None;
  }

 private:
  uint32_t seenGeneration = 0;
  bool active = false;
};
