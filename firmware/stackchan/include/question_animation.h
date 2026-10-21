#pragma once
#include <stddef.h>
#include <stdint.h>

namespace QuestionAnimation {
constexpr int WIDTH = 118;
constexpr int HEIGHT = 203;
constexpr int X = (320 - WIDTH) / 2;
constexpr int Y = 8;
constexpr size_t FRAME_COUNT = 41;
constexpr uint32_t FPS = 30;
constexpr uint32_t DURATION_MS = 1350;
constexpr size_t FRAME_BYTES = WIDTH * HEIGHT * sizeof(uint16_t);
constexpr size_t ASSET_BYTES = FRAME_COUNT * FRAME_BYTES;

inline size_t frameAt(uint32_t elapsedMs) {
  // Clamp before multiplication, so a long approval wait cannot wrap or loop.
  if (elapsedMs >= DURATION_MS) {
    return FRAME_COUNT - 1;
  }
  const size_t frame = elapsedMs * FPS / 1000;
  return frame < FRAME_COUNT ? frame : FRAME_COUNT - 1;
}
}  // namespace QuestionAnimation
