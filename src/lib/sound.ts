// Sound cues. A phone in a pocket is not looking at the screen, and iOS Safari
// has never supported navigator.vibrate, so the buzz alone reaches only half
// the players. There are no sound files: an oscillator per cue is the lot.

/**
 * A cue marks a change worth hearing, never an ongoing state — a GPS fix every
 * second would otherwise turn the proximity warning into a metronome.
 */
const CUES = {
  /** Someone just came inside the heartbeat radius. */
  close: { hz: 220, ms: 110, wave: "square" },
  /** The impostor has just been told where you are, wherever you are. */
  exposed: { hz: 150, ms: 320, wave: "sawtooth" },
  /** A mission paid out: nothing can see you. */
  hidden: { hz: 880, ms: 150, wave: "triangle" },
  /** You are the one who was tagged out. */
  caught: { hz: 80, ms: 600, wave: "sawtooth" },
  /** The match is over. */
  over: { hz: 520, ms: 260, wave: "triangle" },
} as const satisfies Record<
  string,
  { hz: number; ms: number; wave: OscillatorType }
>;

export type Cue = keyof typeof CUES;

let context: AudioContext | null = null;

/**
 * Browsers only let a page make a sound from a gesture, and here that gesture is
 * always a tap on a lobby button. Call this from the click handler itself, never
 * from a callback that arrives over the socket: by then the activation is spent
 * and the context would never start.
 */
export function unlockSound() {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
}

export function cue(kind: Cue) {
  // Silent until a gesture has unlocked the context. A warning nobody can hear
  // beats a thrown TypeError taking the match screen down with it.
  if (!context || context.state !== "running") return;

  const { hz, ms, wave } = CUES[kind];
  const at = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = wave;
  oscillator.frequency.value = hz;
  // Ramps rather than switches: a square edge clicks.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.2, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + ms / 1000);
}
