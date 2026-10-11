import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui";
import { RankCard } from "@/components/RankCard";
import { getViewer } from "@/lib/session";
import { playerStats, recentMatches } from "@/lib/stats";
import { RANKS, rankTag } from "@/lib/ranks";

export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <Suspense fallback={<p className="text-muted">Loading your account…</p>}>
        <Profile />
      </Suspense>
    </main>
  );
}

async function Profile() {
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Not signed in</h1>
        <p className="text-muted">
          Your account, match history and stats will live here once you sign in.
        </p>
        <Link className={`${buttonClass} text-center`} href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  const [stats, results] = await Promise.all([
    playerStats(viewer.id),
    recentMatches(viewer.id),
  ]);

  const cells: [string, string][] = [
    ["Matches", String(stats.matches)],
    ["Wins", String(stats.wins)],
    ["Catches", String(stats.catches)],
    ["Rank", stats.matches === 0 ? "—" : `#${stats.rank}`],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{viewer.username}</h1>
        <p className="text-sm text-muted">
          Playing since{" "}
          {viewer.createdAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        {cells.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-white/10 bg-surface px-3 py-2"
          >
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-lg font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <RankCard points={stats.points} />

      <section className="flex flex-col gap-2">
        <h2 className="text-xs tracking-wide text-muted uppercase">
          The ladder
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {RANKS.map((rank) => {
            const held = rank.tag === rankTag(stats.points);
            return (
              <li
                key={rank.tag}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 ${
                  held
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-white/10 bg-surface text-muted"
                }`}
              >
                <span>{rank.tag}</span>
                <span className="tabular-nums">{rank.at}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {results.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs tracking-wide text-muted uppercase">
            Recent matches
          </h2>
          <ul className="flex flex-col gap-1.5">
            {results.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className={row.won ? "text-accent" : "text-muted"}>
                    {row.won ? "Won" : "Lost"} as {row.role}
                  </span>
                  <span className="text-xs text-muted">
                    {row.match.endedAt.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {row.match.reason}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{row.points} pts</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link className={`${buttonClass} text-center`} href="/play">
        Play a match
      </Link>
      <Link
        className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-center text-muted"
        href="/leaderboard"
      >
        Leaderboard
      </Link>

      <form method="post" action="/api/auth/logout">
        <button className={buttonClass} type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
