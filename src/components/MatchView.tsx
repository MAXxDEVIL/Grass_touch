"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { buttonClass } from "@/components/ui";
import { RankCard } from "@/components/RankCard";
import { catchesOf, clock } from "@/lib/feedback";
import {
  CATCH_M,
  FIX_ERRORS,
  HEARTBEAT_M,
  IDLE_LIMIT_MS,
  LOBBY_CAPACITY,
  MATCH_MS,
  SAFE_MS,
  VISION_M,
  type Fix,
  type FixReply,
  type GameSocket,
  type MatchOver,
  type Mission,
  type Role,
  type Sighted,
} from "@/lib/realtime";
import { cue } from "@/lib/sound";

// Leaflet touches window on import, so it is only ever fetched in the browser.
const GameMap = dynamic(
  () => import("@/components/GameMap").then((module) => module.GameMap),
  {
    ssr: false,
    loading: () => <MapFrame>Loading the map…</MapFrame>,
  },
);

export function MatchView({
  socketRef,
  role,
  points,
  onLeave,
}: {
  /** The connection, owned by the lobby above. Read only from effects. */
  socketRef: RefObject<GameSocket | null>;
  role: Role;
  /** This player's total, baseline plus every match already played this session. */
  points: number;
  onLeave: () => void;
}) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [verdict, setVerdict] = useState<FixReply | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const [exposed, setExposed] = useState(false);
  const [sighted, setSighted] = useState<Sighted[]>([]);
  const [mission, setMission] = useState<Mission | null>(null);
  // Milliseconds of invisibility left. 0 means visible to the impostor.
  const [invisible, setInvisible] = useState(0);
  /** Set once this player is the one who was tagged out. */
  const [out, setOut] = useState(false);
  /** The last thing that happened to anybody, for the one-line ticker. */
  const [news, setNews] = useState<string | null>(null);
  /** Filled in once, when the match ends. */
  const [result, setResult] = useState<MatchOver | null>(null);
  /** What this match was worth to this player, read off the final scores. */
  const [mine, setMine] = useState(0);
  // When the whistle is due. The server is the one that blows it, counting from
  // the moment it started the match — which is this moment, to within a socket
  // round trip. A local timer therefore tracks it, and unlike a server
  // timestamp it is immune to a phone whose own clock is minutes out.
  const [endsAt] = useState(() => Date.now() + MATCH_MS);
  const [now, setNow] = useState(() => Date.now());

  // The socket lives above this screen and is already connected by the time a
  // match starts, and nothing is ever sent to a socket with no position, so
  // none of these can arrive before this listener.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onNearby = ({ near: close }: { near: boolean }) => setNear(close);
    const onExposed = ({ exposed: shown }: { exposed: boolean }) =>
      setExposed(shown);
    const onSighted = (players: Sighted[]) => setSighted(players);
    const onMission = (next: Mission) => setMission(next);
    const onInvisible = ({ forMs }: { forMs: number }) => {
      setInvisible(forMs);
      cue("hidden");
    };
    const onCaught = ({
      victimId,
      victimName,
      byImpostor,
    }: {
      victimId: string;
      victimName: string;
      byImpostor: boolean;
    }) => {
      setNews(
        byImpostor
          ? `${victimName} was caught.`
          : `${victimName} was tagged — the impostor is out.`,
      );
      if (victimId === socket.id) setOut(true);
    };
    const onOver = (match: MatchOver) => {
      // This screen's own seat, found while the socket is still to hand: a ref
      // may not be read during render, and this value is exactly what the
      // end-of-match screen wants to add up.
      setMine(match.scores.find((seat) => seat.id === socket.id)?.points ?? 0);
      setResult(match);
    };

    socket.on("match:nearby", onNearby);
    socket.on("match:exposed", onExposed);
    socket.on("match:sighted", onSighted);
    socket.on("match:mission", onMission);
    socket.on("match:invisible", onInvisible);
    socket.on("match:caught", onCaught);
    socket.on("match:over", onOver);
    return () => {
      socket.off("match:nearby", onNearby);
      socket.off("match:exposed", onExposed);
      socket.off("match:sighted", onSighted);
      socket.off("match:mission", onMission);
      socket.off("match:invisible", onInvisible);
      socket.off("match:caught", onCaught);
      socket.off("match:over", onOver);
    };
  }, [socketRef]);

  // The escape is meant to be watched: tick the remaining seconds down.
  useEffect(() => {
    if (invisible <= 0) return;
    const timer = setTimeout(() => setInvisible(invisible - 1000), 1000);
    return () => clearTimeout(timer);
  }, [invisible]);

  // One clock for the whole screen: the time left until the whistle, and what
  // is left of the scatter window the match opened with.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // Every one of these fires on a change of state rather than on each fix, so a
  // warning stays something that happens instead of something that repeats.
  useEffect(() => {
    if (!near) return;
    // The buzz comes first where there is one. iOS has none, so on an iPhone
    // the sound is the only thing that arrives.
    cue("close");
    if ("vibrate" in navigator) navigator.vibrate(120);
  }, [near]);

  useEffect(() => {
    if (exposed) cue("exposed");
  }, [exposed]);

  useEffect(() => {
    if (out) cue("caught");
  }, [out]);

  useEffect(() => {
    if (result) cue("over");
  }, [result]);

  useEffect(() => {
    // Nothing this player does can matter any more, and the server would refuse
    // the fix anyway.
    if (out) return;
    // True of nothing that can run this app, but a thrown TypeError would take
    // the whole screen with it, so the frame is left waiting instead.
    if (!navigator.geolocation) return;

    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setProblem(null);
        const next: Fix = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        };
        // Shown whatever it says, but only the server decides if it counts.
        setFix(next);
        socketRef.current?.emit("match:position", next, setVerdict);
      },
      (error) => setProblem(explain(error)),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [socketRef, out]);

  const impostor = role === "impostor";
  const left = Math.max(0, endsAt - now);
  const scatterLeft = SAFE_MS - (MATCH_MS - left);
  const urgent = left <= 60_000;

  // Once it is over, the match screen is only in the way.
  if (result) {
    const won = result.winner === "survivors";
    const impostorSeat = result.scores.find(
      (player) => player.id === result.impostorId,
    );
    return (
      <div className="flex flex-col gap-4">
        <div
          className={`rounded-xl border px-4 py-5 text-center ${
            won ? "border-accent/40 bg-accent/10" : "border-danger/40 bg-danger/10"
          }`}
        >
          <p
            className={`text-xs tracking-wide uppercase ${
              won ? "text-accent" : "text-danger"
            }`}
          >
            {won ? "Survivors win" : "The impostor wins"}
          </p>
          <p className="mt-1 text-sm text-muted">{result.reason}</p>
          {impostorSeat && (
            <p className="mt-2 text-sm">
              The impostor was{" "}
              <span className={won ? "text-accent" : "text-danger"}>
                {impostorSeat.name}
              </span>
              .
            </p>
          )}
        </div>

        <ul className="rounded-xl border border-white/10 bg-surface px-4 py-3 text-sm">
          {result.scores.map((player) => {
            const isImpostor = player.id === result.impostorId;
            const catches = catchesOf(
              isImpostor ? "impostor" : "survivor",
              player.points,
            );
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-4 py-1"
              >
                <span className={player.out ? "text-muted line-through" : ""}>
                  {player.name}
                  {isImpostor ? " (impostor)" : ""}
                </span>
                <span className="tabular-nums">
                  {player.points} pts
                  {catches > 0 && (
                    <span className="text-muted">
                      {` · ${catches} ${catches === 1 ? "catch" : "catches"}`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {/* This match's own score, and where it leaves the ladder. The total
            comes from the lobby, which adds each finished match to the baseline
            it loaded with, so a second match in one session still counts. */}
        <p className="text-center text-sm">
          {`+${mine} points for you this match`}
        </p>
        <RankCard points={points} />

        <button className={buttonClass} onClick={onLeave} type="button">
          Back to the lobby
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`rounded-xl border px-4 py-3 ${
          impostor ? "border-danger/40 bg-danger/10" : "border-accent/40 bg-accent/10"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={`text-xs tracking-wide uppercase ${
              impostor ? "text-danger" : "text-accent"
            }`}
          >
            Your role
          </p>
          {/* Not a live region: a screen reader does not need the clock read
              out to it every second. */}
          <p
            className={`text-xs tabular-nums ${
              urgent ? "text-danger" : "text-muted"
            }`}
          >
            {left > 0 ? `${clock(left)} until the whistle` : "The whistle is due"}
          </p>
        </div>
        <p
          className={`text-xl font-semibold ${
            impostor ? "text-danger" : "text-accent"
          }`}
        >
          {impostor ? "Impostor" : "Survivor"}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {impostor
            ? `Survivors inside the red ${VISION_M} × ${VISION_M} m box show as orange — so do those who stood still for ${IDLE_LIMIT_MS / 60_000} minutes. Get within ${CATCH_M} m of one and they are out.`
            : `Only you are on this map. Stand still for ${IDLE_LIMIT_MS / 60_000} minutes and the impostor can see you. Within ${HEARTBEAT_M} m, you will feel it. Finish a mission to vanish for 45 seconds — while invisible, get within ${CATCH_M} m of the impostor to win on the spot.`}
        </p>
        <p className="mt-1 text-xs text-muted">
          {scatterLeft > 0
            ? `Spread out — nobody can be caught for another ${Math.ceil(scatterLeft / 1000)} s.`
            : "The scatter window is over — anyone can be caught now."}
        </p>
      </div>

      {out && (
        <p
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
          role="alert"
        >
          You were caught — you are out of this match. Wait for it to end.
        </p>
      )}

      {news && (
        <p className="text-center text-xs text-warn" role="status">
          {news}
        </p>
      )}

      {mission && (
        <div className="rounded-xl border border-accent-2/40 bg-accent-2/10 px-4 py-3">
          <p className="text-xs tracking-wide text-accent-2 uppercase">
            Your mission
          </p>
          <p className="text-sm">{mission.text}</p>
          <p className="mt-0.5 text-xs text-muted">{meter(mission)}</p>
        </div>
      )}

      {invisible > 0 && (
        <p
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
          role="status"
        >
          Invisible for {Math.ceil(invisible / 1000)} s — nothing can see you.
        </p>
      )}

      {near && (
        <p
          className="animate-pulse text-center text-sm font-medium text-danger"
          role="status"
        >
          ● Someone is close
        </p>
      )}

      {exposed && (
        <p
          className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
          role="alert"
        >
          You have not moved for {IDLE_LIMIT_MS / 60_000} minutes. The impostor can see
          you wherever you are — move to hide again.
        </p>
      )}

      {fix ? (
        <GameMap impostor={impostor} position={fix} sighted={sighted} />
      ) : (
        <MapFrame>Waiting for your position…</MapFrame>
      )}

      <p className="text-center text-xs text-muted">
        {problem ?? status(verdict, fix)}
      </p>

      <button className={buttonClass} onClick={onLeave} type="button">
        Leave match
      </button>
    </div>
  );
}

function MapFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[55vh] min-h-64 w-full items-center justify-center rounded-xl border border-white/10 bg-surface px-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function status(verdict: FixReply | null, fix: Fix | null): string {
  if (!fix) return "Waiting for your position…";

  const metres = Math.round(fix.accuracy);
  if (!verdict) return `±${metres} m`;
  if (!verdict.ok) return FIX_ERRORS[verdict.reason];

  return `Sharing at ±${metres} m · ${verdict.reporting} of ${LOBBY_CAPACITY} reporting`;
}

/** The one number a mission turns on, phrased for its kind. */
function meter(mission: Mission): string {
  if (mission.kind === "walk") {
    return `${mission.progress} m of ${mission.target} m walked`;
  }
  const closest = `${mission.progress} m from the closest player`;
  return mission.kind === "vanish"
    ? `${closest} · need ${mission.target} m`
    : `${closest} · need to be within ${mission.target} m`;
}

function explain(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location is blocked. Allow it for this site, over https, to be findable.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "No position yet. Indoors this often fails — try near a window.";
  }
  return "Still looking for a position…";
}