#include "head_motion.h"
#include "presentation_policy.h"
#include <algorithm>
#include <iostream>

int checks = 0;
int failures = 0;
#define CHECK(condition) do { ++checks; if (!(condition)) { ++failures; \
  std::cerr << __LINE__ << ": " #condition "\n"; } } while (0)

void tick(HeadMotion& head, uint32_t now, bool connected, const char* command = "") {
  fake::state.now = now;
  fake::state.input = command;
  head.update(connected);
}

void noPowerCutOrSettingsWrite() {
  CHECK(std::none_of(fake::state.powerWrites.begin(), fake::state.powerWrites.end(),
                     [](bool value) { return !value; }));
  CHECK(fake::state.settingsWrites.empty());
  CHECK(fake::state.factoryZero == 599);
}

void rebootFrom(int initialPose) {
  fake::state = {};
  fake::state.raw = initialPose;
  HeadMotion head;
  head.begin();
  // Wi-Fi/hello is deliberately delayed beyond servo warmup.
  for (const uint32_t now : {0, 300, 2000, 2300, 3000, 5000}) {
    tick(head, now, false);
  }
  CHECK(fake::state.moves.empty());
  CHECK(fake::state.raw == initialPose);
  tick(head, 6000, true);
  tick(head, 6001, true);
  tick(head, 6351, true);
  CHECK(fake::state.raw == 655);
  CHECK(!fake::state.moves.empty());
  CHECK(std::all_of(fake::state.moves.begin(), fake::state.moves.end(),
                    [](int value) { return value == 655; }));
  noPowerCutOrSettingsWrite();
}

void slowAndLateServo(uint32_t readyAfter) {
  fake::state = {};
  fake::state.readyAfter = readyAfter;
  HeadMotion head;
  head.begin();
  for (uint32_t now = 0; now <= 14000; now += 100) {
    tick(head, now, true);
  }
  CHECK(fake::state.raw == 655);
  CHECK(fake::state.powerCycles == 1);
  CHECK(fake::state.moves == std::vector<int>{655});
  noPowerCutOrSettingsWrite();
}

void hooksCannotLowerAWorkingHead() {
  fake::state = {};
  HeadMotion head;
  PresentationPolicy presentation;
  head.begin();
  tick(head, 0, false);
  tick(head, 2000, false);
  presentation.hello(1);
  tick(head, 2100, true);
  tick(head, 2500, true);
  const auto previousMoves = fake::state.moves.size();
  uint32_t now = 3000;
  for (const auto& event : EVENT_STATES) {
    CHECK(presentation.receive(&event, event.event, now));
    tick(head, now, true);
    CHECK(fake::state.raw == 655);
    now += 1000;
  }
  CHECK(fake::state.moves.size() == previousMoves);
  tick(head, now, false);
  CHECK(fake::state.raw == 655);
  tick(head, now + 350, false);
  CHECK(fake::state.raw == 591);
  tick(head, now + 351, true);
  CHECK(fake::state.raw == 655);
  noPowerCutOrSettingsWrite();
}

void neverReadyAndBoundedMotionFailure() {
  fake::state = {};
  fake::state.available = false;
  HeadMotion head;
  head.begin();
  for (uint32_t now = 0; now <= 14000; now += 100) tick(head, now, true);
  CHECK(fake::state.moves.empty());
  CHECK(fake::state.powerCycles == 1);
  CHECK(fake::state.reads <= 8);
  noPowerCutOrSettingsWrite();
  fake::state.available = true;
  fake::state.writeOK = false;
  for (uint32_t now = 14100; now <= 22000; now += 100) tick(head, now, true);
  CHECK(fake::state.writeAttempts.size() == 3);
  tick(head, 23000, true, "v");
  CHECK(fake::state.output.find("fault=1") != std::string::npos);
  CHECK(fake::state.moves.empty());
}

void explicitDisableAndCalibration() {
  fake::state = {};
  fake::state.level = -1;
  fake::state.automatic = false;
  fake::state.raw = 601;
  HeadMotion head;
  head.begin();
  tick(head, 0, true);
  tick(head, 2000, true);
  tick(head, 3000, true);
  CHECK(fake::state.moves.empty());
  tick(head, 3001, true, "h");
  CHECK(fake::state.level == 601);
  CHECK(!fake::state.automatic);
  tick(head, 3002, true, "e");
  CHECK(fake::state.raw == 665);
  tick(head, 3003, true, "x");
  const auto count = fake::state.moves.size();
  tick(head, 8000, true);
  CHECK(fake::state.moves.size() == count);
  CHECK(!fake::state.automatic);
  CHECK(fake::state.factoryZero == 599);
}

int main() {
  const auto run = [](const char* name, auto test) {
    const int before = failures;
    test();
    std::cout << "CASE " << name << (failures == before ? " PASS" : " FAIL") << '\n';
  };
  run("reboot_from_raised_pose", [] { rebootFrom(655); });
  run("reboot_from_lowered_pose", [] { rebootFrom(591); });
  run("slow_servo_boot_5000ms", [] { slowAndLateServo(5000); });
  run("late_servo_boot_10000ms", [] { slowAndLateServo(10000); });
  run("all_hook_states_keep_head_raised", hooksCannotLowerAWorkingHead);
  run("bounded_motion_failure", neverReadyAndBoundedMotionFailure);
  run("explicit_disable_and_calibration", explicitDisableAndCalibration);
  std::cout << "HEAD_MOTION_INTEGRATION checks=" << checks << " failures=" << failures << '\n';
  return failures ? 1 : 0;
}
