/** Two short sine blips, synthesised on the spot (no audio asset, nothing for the CSP to allow). */
export function beep() {
  try {
    const context = new AudioContext();
    const start = context.currentTime + 0.02;
    for (const offset of [0, 0.2]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(0.16, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.14);
    }
    void context.resume().catch(() => undefined);
    window.setTimeout(() => void context.close().catch(() => undefined), 800);
  } catch {
    // No audio output — the visual pulse and the dock notice still happen.
  }
}
