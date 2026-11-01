#pragma once

// Hardware side effects stay on the main loop; this ordering is the shutdown contract.
template <typename StopAudio, typename ShowPowerOff, typename ShutdownHead, typename PowerOff>
inline void runPowerOffSequence(StopAudio stopAudio, ShowPowerOff showPowerOff,
                                ShutdownHead shutdownHead, PowerOff powerOff) {
  stopAudio(0);
  stopAudio(1);
  showPowerOff();
  shutdownHead();
  powerOff();
}
