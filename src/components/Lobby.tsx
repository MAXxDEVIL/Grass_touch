"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { MatchView } from "@/components/MatchView";
import { RankCard } from "@/components/RankCard";
import { buttonClass, inputClass } from "@/components/ui";
import {
  LOBBY_ERRORS,
  type GameSocket,
  type LobbySnapshot,
  type Role,
} from "@/lib/realtime";
import { unlockSound } from "@/lib/sound";

type Phase = "idle" | "lobby" | "match";

export function Lobby({ points }: { points: number }) {
  // A ref, not state: the socket is created in an effect, read only from
  // callbacks, and never needs to trigger a render of its own.
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Points won since this page loaded. The baseline above was read when the
  // page was rendered, and a session can play several matches without another
  // render, so each finished match is added to it here rather than leaving the
  // ladder showing yesterday's total.
  const [earned, setEarned] = useState(0);

  useEffect(() => {
    let active = true;
    const next: GameSocket = io();
    socketRef.current = next;

    next.on("connect", () => {
      if (!active) return;
      setConnected(true);
      setMyId(next.id ?? null);
    });
    next.on("disconnect", () => {
      if (!active) return;
      setConnected(false);
      // The server keys a seat by socket, so a dropped connection ends it.
      setPhase("idle");
      setLobby(null);
      setRole(null);
      setError("Connection lost — rejoin the lobby.");
    });
    next.on("lobby:state", (state) => {
      if (active) setLobby(state);
    });
    next.on("match:started", ({ role: mine, lobby: state }) => {
      if (!active) return;
      setRole(mine);
      setLobby(state);
      setPhase("match");
    });
    // The lobby keeps its own ear on the end of a match — and only to keep the
    // running total honest, since the match screen is what reports the result.
    next.on("match:over", (match) => {
      if (!active) return;
      const mine = match.scores.find((seat) => seat.id === next.id);
      if (mine) setEarned((was) => was + mine.points);
    });

    return () => {
      active = false;
      next.close();
      socketRef.current = null;
    };
  }, []);

  const create = () => {
    // A tap is the gesture browsers require before a page may make noise, and
    // this is the one everybody who plays has to make. See src/lib/sound.ts.
    unlockSound();
    setError(null);
    setBusy(true);
    socketRef.current?.emit("lobby:create", (reply) => {
      setBusy(false);
      if (!reply.ok) return setError(LOBBY_ERRORS[reply.error]);
      setLobby(reply.lobby);
      setPhase("lobby");
    });
  };

  const join = () => {
    unlockSound();
    setError(null);
    setBusy(true);
    socketRef.current?.emit("lobby:join", { code }, (reply) => {
      setBusy(false);
      if (!reply.ok) return setError(LOBBY_ERRORS[reply.error]);
      setLobby(reply.lobby);
      setPhase("lobby");
    });
  };

  const leave = () => {
    socketRef.current?.emit("lobby:leave");
    setLobby(null);
    setRole(null);
    setPhase("idle");
    setError(null);
    setCode("");
  };

  const start = () => {
    unlockSound();
    setError(null);
    socketRef.current?.emit("match:start", (reply) => {
      if (!reply.ok) setError(LOBBY_ERRORS[reply.error]);
    });
  };

  const total = points + earned;

  if (!connected) {
    return <p className="text-muted">Connecting…</p>;
  }

  if (phase === "match" && role) {
    return (
      <MatchView
        socketRef={socketRef}
        role={role}
        points={total}
        onLeave={leave}
      />
    );
  }

  if (phase === "lobby" && lobby) {
    const isHost = lobby.hostId === myId;
    const full = lobby.players.length >= lobby.capacity;

    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-white/10 bg-surface p-4 text-center">
          <p className="text-xs tracking-wide text-muted uppercase">Lobby code</p>
          <p className="font-mono text-3xl font-semibold tracking-[0.3em] text-accent">
            {lobby.code}
          </p>
          <p className="mt-1 text-xs text-muted">
            {full
              ? "Everyone is here."
              : `Waiting for ${lobby.capacity - lobby.players.length} more`}
          </p>
        </div>

        <Roster lobby={lobby} myId={myId} />

        {error && <ErrorNote message={error} />}

        {isHost ? (
          <button
            className={buttonClass}
            disabled={!full}
            onClick={start}
            type="button"
          >
            {full ? "Start match" : `Need ${lobby.capacity} players`}
          </button>
        ) : (
          <p className="text-center text-sm text-muted">
            Waiting for the host to start…
          </p>
        )}

        <button
          className="text-sm text-muted underline"
          onClick={leave}
          type="button"
        >
          Leave lobby
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Play</h1>

      <RankCard points={total} />

      {error && <ErrorNote message={error} />}

      <button className={buttonClass} disabled={busy} onClick={create} type="button">
        Create a lobby
      </button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-white/10" />
        or join one
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          join();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Lobby code
          <input
            className={`${inputClass} text-center font-mono text-xl tracking-[0.3em] uppercase`}
            maxLength={4}
            onChange={(changeEvent) => setCode(changeEvent.target.value.toUpperCase())}
            placeholder="ABCD"
            value={code}
          />
        </label>
        <button
          className="rounded-lg border border-white/10 bg-surface px-4 py-2.5 text-ink disabled:opacity-50"
          disabled={busy || code.length < 4}
          type="submit"
        >
          Join lobby
        </button>
      </form>
    </div>
  );
}

function Roster({
  lobby,
  myId,
}: {
  lobby: LobbySnapshot;
  myId: string | null;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: lobby.capacity }, (_, index) => {
        const player = lobby.players[index];
        return (
          <li
            className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface px-3 py-2.5"
            key={index}
          >
            <span className="w-4 text-xs text-muted">{index + 1}</span>
            {player ? (
              <span className="flex-1 truncate">
                {player.name}
                {player.id === myId && <span className="text-muted"> (you)</span>}
              </span>
            ) : (
              <span className="flex-1 text-muted">Empty</span>
            )}
            {player?.isHost && (
              <span className="text-xs tracking-wide text-accent-2 uppercase">
                host
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {message}
    </p>
  );
}
