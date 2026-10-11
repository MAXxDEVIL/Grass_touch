import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { rankTag } from "@/lib/ranks";
import { getViewer } from "@/lib/session";
import { leaderboard, playerStats, rankedPlayers, type BoardRow } from "@/lib/stats";

export const metadata = { title: "Leaderboard — Impostor Hunt" };

export default function LeaderboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-muted">
          Every point banked, across every match played.
        </p>
      </div>

      <Suspense fallback={<p className="text-muted">Counting…</p>}>
        <Board />
      </Suspense>

      <Link className={`${buttonClass} text-center`} href="/play">
        Play a match
      </Link>
      <Link
        className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-center text-muted"
        href="/"
      >
        Home
      </Link>
    </main>
  );
}

async function Board() {
  const viewer = await getViewer();
  const [rows, ranked, stats] = await Promise.all([
    leaderboard(),
    rankedPlayers(),
    viewer ? playerStats(viewer.id) : null,
  ]);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-surface px-4 py-6 text-center text-sm text-muted">
        No matches have been played yet. Be the first on the board.
      </p>
    );
  }

  // The reader's own row, whether or not it fits in the top slice. Every part of
  // it is already in hand: the record from the same query the account page uses,
  // and the name from the session.
  const mine: BoardRow | null =
    viewer && stats && stats.matches > 0
      ? {
          username: viewer.username,
          points: stats.points,
          matches: stats.matches,
          wins: stats.wins,
          rank: stats.rank,
        }
      : null;
  const listed = rows.some((row) => row.username === mine?.username);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {`${ranked} ${ranked === 1 ? "player" : "players"} ranked`}
        {mine && ` · you are #${mine.rank}`}
      </p>

      <ol className="flex flex-col gap-2">
        {rows.map((row) => (
          <Row key={row.username} row={row} you={row.username === mine?.username} />
        ))}
        {mine && !listed && (
          <>
            <li className="text-center text-xs text-muted">···</li>
            <Row row={mine} you />
          </>
        )}
      </ol>

      {!viewer && (
        <p className="text-xs text-muted">Sign in to see where you stand.</p>
      )}
    </div>
  );
}

function Row({ row, you }: { row: BoardRow; you: boolean }) {
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        you ? "border-accent/40 bg-accent/10" : "border-white/10 bg-surface"
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="w-5 shrink-0 text-right text-sm text-muted tabular-nums">
          {row.rank}
        </span>
        <span className="truncate">
          {row.username}
          {you && <span className="text-muted"> (you)</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-sm">
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
          {rankTag(row.points)}
        </span>
        <span className="tabular-nums">{row.points} pts</span>
      </span>
    </li>
  );
}
