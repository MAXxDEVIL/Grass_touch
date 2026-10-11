// The rules of the hunt as pure functions: no sockets, no clock of their own,
// no state. server.ts runs them on every fix, and the phase 6 check tests this
// same code directly rather than waiting five minutes for the idle clock.
import {
  CATCH_M,
  HEARTBEAT_M,
  IDLE_LIMIT_MS,
  MAX_SPEED_MPS,
  METRES_PER_DEGREE,
  MOVED_M,
  VISION_M,
  type Fix,
} from "./realtime.ts";

/** What the server remembers about one player's position. */
export interface Track {
  /** The last fix that was accepted. */
  fix: Fix;
  /** When that fix arrived, on the server's clock. */
  at: number;
  /** Where they were when the idle clock last reset. */
  anchor: { lat: number; lng: number };
  /** When the anchor last reset, i.e. when they last really moved. */
  movedAt: number;
  /** Whether they have already been told they are exposed. */
  exposed: boolean;
  /** Whether they have already been told someone is close. */
  near: boolean;
  /** A completed mission's reward: nobody can see them until this passes. */
  invisibleUntil: number;
}

/**
 * Metres between two fixes, on a flat approximation. The whole game happens in
 * tens of metres, where the curve of the earth is far smaller than GPS error.
 */
export function metresApart(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * METRES_PER_DEGREE;
  const dLng =
    (a.lng - b.lng) * METRES_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Could they have got from one fix to the other by moving? Both fixes are
 * uncertain by their own accuracy, so that is added to what is allowed; the
 * rest has to fit inside MAX_SPEED_MPS. Elapsed time comes from the server's
 * arrival clock, so a client that sends in a burst buys no extra distance.
 */
export function plausibleMove(from: Fix, to: Fix, elapsedMs: number): boolean {
  const allowed =
    from.accuracy + to.accuracy + MAX_SPEED_MPS * (elapsedMs / 1000);
  return metresApart(from, to) <= allowed;
}

/**
 * Folds an accepted fix into the track. The idle clock only resets on a move
 * larger than MOVED_M, so ordinary GPS wander does not read as walking.
 *
 * shortcut: with a poor fix, wander can exceed MOVED_M on its own and reset the
 * clock, so a still player on bad GPS may never be exposed — the forgiving
 * direction. The fix is to compare against a smoothed position when a camping
 * penalty has to be reliable.
 */
export function nextTrack(
  previous: Track | null,
  fix: Fix,
  now: number,
): Track {
  if (!previous) {
    return {
      fix,
      at: now,
      anchor: { lat: fix.lat, lng: fix.lng },
      movedAt: now,
      exposed: false,
      near: false,
      invisibleUntil: 0,
    };
  }

  const walked = metresApart(previous.anchor, fix) > MOVED_M;

  return {
    ...previous,
    fix,
    at: now,
    anchor: walked ? { lat: fix.lat, lng: fix.lng } : previous.anchor,
    movedAt: walked ? now : previous.movedAt,
  };
}

/** Standing still for the limit is what exposes a player; moving again hides them. */
export function exposedAt(track: Track, now: number): boolean {
  return now - track.movedAt > IDLE_LIMIT_MS;
}

/** Inside the impostor's 40 x 40 m box, which is half the box each way. */
export function inVision(eye: Fix, target: Fix): boolean {
  const halfLat = VISION_M / 2 / METRES_PER_DEGREE;
  const halfLng = halfLat / Math.cos((eye.lat * Math.PI) / 180);
  return (
    Math.abs(target.lat - eye.lat) <= halfLat &&
    Math.abs(target.lng - eye.lng) <= halfLng
  );
}

/**
 * Close enough to feel. Anyone can feel anyone — a survivor cannot tell a
 * friend from the impostor, and that is the whole point of the pulse.
 *
 * shortcut: the radius is the spec's 10 m with no allowance for GPS error, so a
 * neighbour inside it can still be missed. Widen by the two accuracies when the
 * pulse has to be a guarantee rather than a hint.
 */
export function feelsNear(a: Fix, b: Fix): boolean {
  return metresApart(a, b) <= HEARTBEAT_M;
}

/**
 * Has this player stopped reporting? A phone that dies mid-match keeps its last
 * position forever, and a ghost that cannot be seen is also a ghost that must
 * not be tagged, so both checks ask this first.
 *
 * shortcut: 45 s is a guess at how long a phone may go quiet without having
 * left; a pocketed phone can throttle its GPS for longer than that.
 */
export const STALE_MS = 45_000;

export function stale(track: Track, now: number): boolean {
  return now - track.at > STALE_MS;
}

/**
 * Close enough to take hold of. The impostor tagging a survivor and a survivor
 * tagging the impostor happen at the same distance; which of the two it is
 * comes down to whether the survivor is invisible, and the server decides that.
 */
export function touching(a: Fix, b: Fix): boolean {
  return metresApart(a, b) <= CATCH_M;
}
