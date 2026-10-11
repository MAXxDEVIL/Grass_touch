import { rankProgress } from "@/lib/ranks";

/**
 * The rank a total has reached and how far the next tag is. The account page and
 * the end of a match show the same card, so a player is climbing one ladder in
 * both places rather than reading two different descriptions of their score.
 */
export function RankCard({ points }: { points: number }) {
  const band = rankProgress(points);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-accent">{band.tag}</p>
        <p className="text-xs tabular-nums text-muted">{points} points</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${band.percent}%` }}
        />
      </div>
      <p className="text-xs text-muted">
        {band.next
          ? `${band.next.at - points} more points for ${band.next.tag}.`
          : "The top of the ladder."}
      </p>
    </section>
  );
}
