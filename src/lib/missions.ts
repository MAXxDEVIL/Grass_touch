// Missions, as the server hands them out and judges them. Pure apart from the
// random draw, which is a parameter so the phase 7 check can be deterministic.
import { randomUUID } from "node:crypto";
import {
  MOVED_M,
  type Fix,
  type Mission,
  type MissionKind,
} from "./realtime.ts";
import { metresApart } from "./match-rules.ts";

/** How far each kind asks for, in metres. */
const BANDS: Record<MissionKind, [number, number]> = {
  walk: [60, 120],
  vanish: [40, 90],
  // The dangerous one: it sends a survivor towards other people, where the
  // impostor already is.
  approach: [15, 35],
};

const LINES: Record<MissionKind, (metres: number) => string> = {
  walk: (m) => `Walk at least ${m} m from where you started.`,
  vanish: (m) => `Get at least ${m} m away from every other player.`,
  approach: (m) =>
    `Get within ${m} m of another player — after leaving here by at least ${MOVED_M} m.`,
};

/** A mission plus the state only the server keeps. */
export interface Assigned extends Mission {
  /** Where it was issued. Only `walk` still reads it after generation. */
  anchor: { lat: number; lng: number };
  /** The progress last sent, so it is only re-sent when it really moves. */
  told: number;
  /**
   * Whether they have ever been far enough away that this could be a real
   * journey, so an "approach" is not completed for free at the spawn point.
   * Set once, never unset: missions are judged only from then on.
   */
  away: boolean;
}

/** Progress is re-sent once it has moved this far, and not before. */
export const PROGRESS_STEP_M = 5;

/**
 * Where missions come from. One function, one place: v1 draws a template, and
 * phase 14 replaces this body with a call to an open-weight model.
 */
export function generateMission(
  anchor: { lat: number; lng: number },
  random: () => number = Math.random,
): Assigned {
  const kinds = Object.keys(BANDS) as MissionKind[];
  const kind = kinds[Math.floor(random() * kinds.length)];
  const [low, high] = BANDS[kind];
  const target = Math.round(low + random() * (high - low));

  return {
    id: randomUUID(),
    kind,
    target,
    progress: 0,
    text: LINES[kind](target),
    anchor,
    told: 0,
    away: false,
  };
}

/**
 * How far along a mission is, in metres. `nearest` is the distance to the
 * closest other player, or Infinity when there is nobody to measure against.
 */
export function missionProgress(
  mission: Assigned,
  fix: Fix,
  nearest: number,
): number {
  return mission.kind === "walk"
    ? Math.round(metresApart(mission.anchor, fix))
    : Math.round(nearest);
}

/** Two kinds want you far away, and one wants you uncomfortably close. */
export function missionMet(mission: Assigned, progress: number): boolean {
  return mission.kind === "approach"
    ? progress <= mission.target
    : progress >= mission.target;
}
