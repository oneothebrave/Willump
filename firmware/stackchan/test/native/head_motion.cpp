#include "head_motion.h"
#include "control_protocol.h"
#include "power_off.h"
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

void shutdownFromRaisedPose() {
  fake::state = {};
  HeadMotion head;
  head.begin();
  for (uint32_t now = 0; now <= 3000; now += 100) tick(head, now, true);
  CHECK(fake::state.raw == 655);

  fake::state.moves.clear();
  fake::state.writeAttempts.clear();
  fake::state.torqueWrites.clear();
  fake::state.powerWrites.clear();
  fake::state.delays.clear();
  fake::state.events.clear();
  head.shutdown();

  CHECK(fake::state.moves == std::vector<int>{591});
  CHECK(fake::state.writeAttempts == std::vector<int>{591});
  CHECK(fake::state.delays == std::vector<uint32_t>{1000});
  CHECK(fake::state.torqueWrites == std::vector<int>{0});
  CHECK(fake::state.powerWrites == std::vector<bool>{false});
  CHECK((fake::state.events ==
         std::vector<std::string>{"move", "torque-off", "vm-off"}));
  CHECK(fake::state.automatic);
  CHECK(fake::state.settingsWrites.empty());
  CHECK(fake::state.factoryZero == 599);
  CHECK(fake::state.level == 591);
}

void shutdownMoveFailureIsBounded() {
  fake::state = {};
  HeadMotion head;
  head.begin();
  for (uint32_t now = 0; now <= 3000; now += 100) tick(head, now, true);

  fake::state.moves.clear();
  fake::state.writeAttempts.clear();
  fake::state.torqueWrites.clear();
  fake::state.powerWrites.clear();
  fake::state.delays.clear();
  fake::state.events.clear();
  fake::state.writeOK = false;
  head.shutdown();

  CHECK(fake::state.writeAttempts == std::vector<int>{591});
  CHECK(fake::state.moves.empty());
  CHECK(fake::state.delays.empty());
  CHECK(fake::state.torqueWrites == std::vector<int>{0});
  CHECK(fake::state.powerWrites == std::vector<bool>{false});
  CHECK((fake::state.events == std::vector<std::string>{"torque-off", "vm-off"}));
}

void shutdownUncalibratedAndUnavailable() {
  fake::state = {};
  fake::state.level = -1;
  fake::state.automatic = false;
  fake::state.raw = 601;
  HeadMotion head;
  head.begin();
  for (uint32_t now = 0; now <= 3000; now += 100) tick(head, now, true);

  fake::state.torqueWrites.clear();
  fake::state.powerWrites.clear();
  fake::state.delays.clear();
  fake::state.events.clear();
  head.shutdown();
  CHECK(fake::state.moves.empty());
  CHECK(fake::state.delays.empty());
  CHECK(fake::state.torqueWrites == std::vector<int>{0});
  CHECK(fake::state.powerWrites == std::vector<bool>{false});
  CHECK(fake::state.level == -1);
  CHECK(!fake::state.automatic);

  fake::state = {};
  fake::state.available = false;
  HeadMotion unavailable;
  unavailable.begin();
  for (uint32_t now = 0; now <= 14000; now += 100) tick(unavailable, now, true);
  fake::state.torqueWrites.clear();
  fake::state.powerWrites.clear();
  fake::state.delays.clear();
  unavailable.shutdown();
  CHECK(fake::state.writeAttempts.empty());
  CHECK(fake::state.delays.empty());
  CHECK(fake::state.torqueWrites == std::vector<int>{0});
  CHECK(fake::state.powerWrites == std::vector<bool>{false});
}

void powerOffSequenceOrdering() {
  std::vector<std::string> order;
  runPowerOffSequence(
      [&](int channel) { order.push_back("audio" + std::to_string(channel)); },
      [&] { order.push_back("display"); }, [&] { order.push_back("head"); },
      [&] { order.push_back("power"); });
  CHECK((order == std::vector<std::string>{"audio0", "audio1", "display", "head", "power"}));
}

void controlCommandHistoryTests() {
  ControlCommandHistory history;
  CHECK(!history.contains("first"));
  history.remember("first");
  CHECK(history.contains("first"));
  history.remember("first");
  history.remember("second");
  history.remember("third");
  history.remember("fourth");
  CHECK(history.contains("first"));
  history.remember("fifth");
  CHECK(!history.contains("first"));
  CHECK(history.contains("fifth"));
  CHECK(history.contains("fourth"));
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
  run("shutdown_from_raised_pose", shutdownFromRaisedPose);
  run("shutdown_move_failure_is_bounded", shutdownMoveFailureIsBounded);
  run("shutdown_uncalibrated_and_unavailable", shutdownUncalibratedAndUnavailable);
  run("power_off_sequence_ordering", powerOffSequenceOrdering);
  run("control_command_history", controlCommandHistoryTests);
  std::cout << "HEAD_MOTION_INTEGRATION checks=" << checks << " failures=" << failures << '\n';
  return failures ? 1 : 0;
}
