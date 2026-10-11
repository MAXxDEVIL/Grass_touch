import Link from "next/link";
import { Suspense } from "react";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { buttonClass } from "@/components/ui";
import {
  CATCH_M,
  IDLE_LIMIT_MS,
  INVISIBLE_MS,
  MATCH_MS,
  SAFE_MS,
  VISION_M,
} from "@/lib/realtime";
import { getViewer } from "@/lib/session";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Impostor <span className="text-accent">Hunt</span>
        </h1>
        <p className="text-muted">
          Five players, one impostor, one neighbourhood. Play on your phone and
          keep moving.
        </p>
      </div>

      <ConnectionBadge />

      <Suspense fallback={null}>
        <AccountNav />
      </Suspense>

      {/* The four rules, in the order a match needs them. Static, so it is in
          the first paint and in the HTML a search engine or a check sees. */}
      <section className="flex w-full flex-col gap-3">
        <h2 className="text-center text-xs tracking-wide text-muted uppercase">
          How it works
        </h2>
        <ul className="flex flex-col gap-2 text-left text-sm text-muted">
          <li>
            {`Five players, one impostor. Everyone joins the same lobby with its four-character code and walks. Nobody is told who the impostor is.`}
          </li>
          <li>
            <span className="text-ink">Survivors</span>
            {` finish missions to vanish for ${INVISIBLE_MS / 1000} seconds. Stand still for ${IDLE_LIMIT_MS / 60_000} minutes and the impostor can see you wherever you are.`}
          </li>
          <li>
            <span className="text-ink">The impostor</span>
            {` sees anyone inside a ${VISION_M} × ${VISION_M} m box, and gets a survivor out by getting within ${CATCH_M} m of them.`}
          </li>
          <li>
            <span className="text-ink">
              {`Nobody can be caught for the first ${SAFE_MS / 1000} seconds.`}
            </span>
            {` After that it is a ${MATCH_MS / 60_000}-minute hunt, and the score takes it if neither side has won.`}
          </li>
        </ul>
      </section>
    </main>
  );
}

async function AccountNav() {
  const viewer = await getViewer();

  const board = (
    <Link
      className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-center text-muted"
      href="/leaderboard"
    >
      Leaderboard
    </Link>
  );

  if (viewer) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Link className={`${buttonClass} text-center`} href="/play">
          Play
        </Link>
        <p className="text-center text-sm text-muted">
          Signed in as <span className="text-ink">{viewer.username}</span>
        </p>
        <Link
          className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-center text-muted"
          href="/account"
        >
          Your account
        </Link>
        {board}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <Link className={`${buttonClass} text-center`} href="/register">
        Create account
      </Link>
      <Link
        className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-center text-muted"
        href="/login"
      >
        Sign in
      </Link>
      {board}
    </div>
  );
}
