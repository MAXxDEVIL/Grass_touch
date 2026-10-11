// Reading finished matches back: the global board, one player's record, and the
// handful of results they last played. Plain Node can import this file, so the
// phase 9 check asserts against the same queries the pages render.
import { prisma } from "./db.ts";

export interface BoardRow {
  username: string;
  points: number;
  matches: number;
  wins: number;
  /** Position on the board, 1-based. Rows level on points share one. */
  rank: number;
}

export interface PlayerStats {
  matches: number;
  wins: number;
  catches: number;
  points: number;
  /** Position on the global board, 1-based. Ties share the better position. */
  rank: number;
}

/**
 * The top players by points. Sums and counts come out of one pass over the
 * results table, ordered by points, then wins, then name so the board is stable.
 *
 * The position comes from the same ranking the account page uses — one more than
 * the number of players strictly ahead — rather than from the row's place in
 * this list, which is capped by `limit` and would number two players level on
 * points differently depending on where the cut fell.
 */
export async function leaderboard(limit = 20): Promise<BoardRow[]> {
  return prisma.$queryRaw<BoardRow[]>`
    SELECT u.username,
           COALESCE(SUM(p.points), 0)::int AS points,
           COUNT(*)::int AS matches,
           COUNT(*) FILTER (WHERE p.won)::int AS wins,
           RANK() OVER (ORDER BY COALESCE(SUM(p.points), 0) DESC)::int AS rank
      FROM "MatchPlayer" p
      JOIN "User" u ON u.id = p."userId"
     GROUP BY u.username
     ORDER BY points DESC, wins DESC, u.username ASC
     LIMIT ${limit}
  `;
}

/**
 * How many players are on the board at all. A position out of a field is worth
 * more than a position out of a page, and the board is capped at 20 rows.
 */
export async function rankedPlayers(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ ranked: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS ranked FROM "MatchPlayer"
  `;
  return row.ranked;
}

/** One player's whole record, and where it puts them on the board. */
export async function playerStats(userId: string): Promise<PlayerStats> {
  const [stats] = await prisma.$queryRaw<PlayerStats[]>`
    SELECT
      (SELECT COUNT(*)::int FROM "MatchPlayer" WHERE "userId" = ${userId}) AS matches,
      (SELECT COUNT(*)::int FROM "MatchPlayer"
        WHERE "userId" = ${userId} AND won) AS wins,
      (SELECT COALESCE(SUM(catches), 0)::int FROM "MatchPlayer"
        WHERE "userId" = ${userId}) AS catches,
      (SELECT COALESCE(SUM(points), 0)::int FROM "MatchPlayer"
        WHERE "userId" = ${userId}) AS points,
      (SELECT COUNT(*)::int + 1 FROM (
        SELECT "userId" FROM "MatchPlayer"
         GROUP BY "userId"
        HAVING SUM(points) > (
          SELECT COALESCE(SUM(points), 0) FROM "MatchPlayer"
           WHERE "userId" = ${userId}
        )
      ) AS ahead) AS rank
  `;
  return stats;
}

/** The last few matches that player was in, newest first. */
export async function recentMatches(userId: string, take = 5) {
  return prisma.matchPlayer.findMany({
    where: { userId },
    orderBy: { match: { endedAt: "desc" } },
    take,
    select: {
      id: true,
      role: true,
      points: true,
      catches: true,
      caught: true,
      won: true,
      match: { select: { winner: true, reason: true, endedAt: true } },
    },
  });
}
