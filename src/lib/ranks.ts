// The ladder. One table, so the tag on the board, the progress on the account
// page and the line after a match are all reading the same numbers.
// Plain Node can import this file, so the check runs the page's own arithmetic.

export interface Rank {
  tag: string;
  /** The total at which the tag is reached. */
  at: number;
}

/**
 * Deliberately coarse. A band is meant to be a few evenings of play rather than
 * a match, and every account starts on the bottom rung — a ladder whose floor is
 * above zero would leave a new player with no tag and no progress bar.
 */
export const RANKS: Rank[] = [
  { tag: "Newcomer", at: 0 },
  { tag: "Rookie", at: 20 },
  { tag: "Regular", at: 75 },
  { tag: "Hunter", at: 200 },
  { tag: "Legend", at: 500 },
];

/** The band a total has reached. */
function reached(points: number): number {
  let band = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].at) band = i;
  return band;
}

/** The tag a total has reached. */
export function rankTag(points: number): string {
  return RANKS[reached(points)].tag;
}

export interface RankProgress {
  /** The tag held now. */
  tag: string;
  /** That band's floor, which the percentage is measured from. */
  at: number;
  /** 0–100 toward the next tag, floored so a bar is only ever full at the top. */
  percent: number;
  /** The next tag up, or null at the top of the ladder. */
  next: Rank | null;
}

/** What the next tag costs, for the account page and the end of a match. */
export function rankProgress(points: number): RankProgress {
  const band = reached(points);
  const here = RANKS[band];
  const next = RANKS[band + 1] ?? null;
  return {
    tag: here.tag,
    at: here.at,
    percent: next
      ? Math.floor(((points - here.at) / (next.at - here.at)) * 100)
      : 100,
    next,
  };
}
