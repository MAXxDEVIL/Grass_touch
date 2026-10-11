import Link from "next/link";
import { Suspense } from "react";
import { Lobby } from "@/components/Lobby";
import { buttonClass } from "@/components/ui";
import { getViewer } from "@/lib/session";
import { playerStats } from "@/lib/stats";

export default function PlayPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Sign in to play</h1>
        <p className="text-muted">
          Matches are recorded against your account, so playing needs one.
        </p>
        <Link className={`${buttonClass} text-center`} href="/login">
          Sign in
        </Link>
        <Link
          className="text-center text-sm text-muted underline"
          href="/register"
        >
          Create an account
        </Link>
      </div>
    );
  }

  // Read once, when the page renders: the running total for the session is kept
  // in the lobby, which adds each finished match to this baseline.
  const { points } = await playerStats(viewer.id);

  return <Lobby points={points} />;
}
