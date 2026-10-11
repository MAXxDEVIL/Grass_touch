// The two bits of arithmetic behind the match screen. They live here rather
// than in the component so they can be checked from plain Node, the way the
// match rules are.
import { IMPOSTOR_POINTS, SURVIVOR_POINTS, type Role } from "./realtime.ts";

/**
 * A countdown as a player reads it. Seconds round up, so the last second of a
 * match still shows 0:01 instead of sitting at 0:00, and a clock that has
 * already run out never renders as a negative.
 */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * How many catches a score was paid for. Points only ever come from catches, at
 * one of two fixed rates, so the result screen can say what each player did
 * without the server having to send a count it already stores separately.
 */
export function catchesOf(role: Role, points: number): number {
  const each = role === "impostor" ? IMPOSTOR_POINTS : SURVIVOR_POINTS;
  return Math.round(points / each);
}
