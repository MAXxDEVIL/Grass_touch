import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { missionWording } from "./src/lib/ai.ts";
import {
  exposedAt,
  feelsNear,
  inVision,
  metresApart,
  nextTrack,
  plausibleMove,
  stale,
  touching,
  type Track,
} from "./src/lib/match-rules.ts";
import {
  generateMission,
  missionMet,
  missionProgress,
  PROGRESS_STEP_M,
  type Assigned,
} from "./src/lib/missions.ts";
import { prisma } from "./src/lib/db.ts";
import {
  IMPOSTOR_POINTS,
  INVISIBLE_MS,
  LOBBY_CAPACITY,
  MATCH_MS,
  MAX_ACCURACY_M,
  MOVED_M,
  SAFE_MS,
  SURVIVOR_POINTS,
  type ClientToServerEvents,
  type Fix,
  type FixReply,
  type LobbyPlayer,
  type LobbyReply,
  type LobbySnapshot,
  type MatchOver,
  type Mission,
  type ServerToClientEvents,
  type Sighted,
  type StartReply,
} from "./src/lib/realtime.ts";
import {
  SESSION_COOKIE,
  viewerFromToken,
  type Viewer,
} from "./src/lib/session-record.ts";

declare module "socket.io" {
  interface SocketData {
    viewer: Viewer | null;
    /** The code of the lobby this socket is in, if any. */
    code: string | null;
  }
}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "localhost";

interface Room {
  code: string;
  hostId: string;
  /** Server-side only. A broadcast of this would hand the game away. */
  impostorId: string | null;
  /** Join order, which is also slot order. */
  players: LobbyPlayer[];
  phase: "lobby" | "playing" | "over";
  /** When the match began: the clock and the scatter window both read it. */
  startedAt: number;
  /** Points per socket, wiped when a match starts. */
  scores: Map<string, number>;
  /** Sockets tagged out. They keep their seat and their score until they leave. */
  out: Set<string>;
}

// Match state is in memory on purpose: one process, five players, no Redis.
// shortcut: lobbies and positions are lost on restart, and a seat is a socket,
// so a phone that reconnects loses its place — move this to Postgres or Redis
// once a match has to survive a deploy.
const rooms = new Map<string, Room>();

/** The last position each socket sent, and the clocks that hang off it. */
const tracks = new Map<string, Track>();

/** The objective each surviving socket is working on, if any. */
const missions = new Map<string, Assigned>();

/** No 0/O/1/I, so a code can be read aloud without being misheard. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: 4 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function snapshot(room: Room): LobbySnapshot {
  return {
    code: room.code,
    hostId: room.hostId,
    capacity: LOBBY_CAPACITY,
    // A copy, so a later mutation cannot leak into an already-sent payload.
    players: room.players.map((player) => ({ ...player })),
  };
}

/** How many of this room's players have a usable position right now. */
function reporting(room: Room): number {
  return room.players.reduce(
    (count, player) => (tracks.has(player.id) ? count + 1 : count),
    0,
  );
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Coordinates arrive from a phone and are believed by nobody. Anything that is
 * not a real number in range is refused here rather than filtered later.
 */
function readFix(value: unknown): Fix | null {
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng, accuracy } = value as Partial<Record<string, unknown>>;

  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    return null;
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    return null;
  }
  if (
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return null;
  }

  return { lat, lng, accuracy };
}

/**
 * socket.io lets a client send no payload and no reply callback at all, so a
 * listener can be reached with neither, either, or both. Calling a callback
 * that was never sent throws out of the listener and takes the process down.
 */
function replyTo<T>(value: unknown): (reply: T) => void {
  return typeof value === "function" ? (value as (reply: T) => void) : () => {};
}

/** How far the closest other tracked player is, or Infinity when there is none. */
function nearestOther(room: Room, mine: string, here: Fix): number {
  let closest = Infinity;
  for (const other of room.players) {
    if (other.id === mine) continue;
    const theirs = tracks.get(other.id);
    if (!theirs) continue;
    closest = Math.min(closest, metresApart(here, theirs.fix));
  }
  return closest;
}

/** The part of a mission the player holding it is allowed to see. */
function wire(mission: Assigned): Mission {
  const { id, kind, text, target, progress } = mission;
  return { id, kind, text, target, progress };
}

/**
 * Swaps a mission's template wording for the model's when it arrives, in the
 * background — a fix never waits on the model. Guarded by identity, so a late
 * reply cannot overwrite the newer mission the player is already reading.
 */
function enrichMission(ownerId: string, mission: Assigned): void {
  void missionWording(wire(mission)).then((text) => {
    if (text === mission.text) return;
    mission.text = text;
    if (missions.get(ownerId) === mission) {
      io.to(ownerId).emit("match:mission", wire(mission));
    }
  });
}

/**
 * Objectives for the survivors, and the reward for finishing one: 45 seconds
 * nobody can see you. As with everything else, the server decides whether a
 * mission is done — the survivor is only ever told how it is going.
 */
function handOut(room: Room, now: number): void {
  for (const player of room.players) {
    if (player.id === room.impostorId) continue; // the impostor has only to hunt
    const track = tracks.get(player.id);
    if (!track) continue;

    let mission = missions.get(player.id);
    const fresh = !mission;
    if (!mission) {
      mission = generateMission({ lat: track.fix.lat, lng: track.fix.lng });
      missions.set(player.id, mission);
      // The template wording is what the survivor sees this instant; the
      // model's richer words arrive a beat later if it answers in time.
      enrichMission(player.id, mission);
    }

    // A mission is only judged after a real journey. Without this, "get close
    // to another player" pays out for free whenever a match starts with people
    // already standing near each other, which is exactly how every match starts.
    if (!mission.away && metresApart(mission.anchor, track.fix) >= MOVED_M) {
      mission.away = true;
    }

    const progress = missionProgress(
      mission,
      track.fix,
      nearestOther(room, player.id, track.fix),
    );
    // Nobody else on the map to measure against yet.
    if (!Number.isFinite(progress)) continue;

    if (mission.away && missionMet(mission, progress)) {
      track.invisibleUntil = now + INVISIBLE_MS;
      io.to(player.id).emit("match:invisible", { forMs: INVISIBLE_MS });
      // A fresh one is drawn on their next fix.
      missions.delete(player.id);
      continue;
    }

    if (fresh || Math.abs(progress - mission.told) >= PROGRESS_STEP_M) {
      mission.told = progress;
      mission.progress = progress;
      io.to(player.id).emit("match:mission", wire(mission));
    }
  }
}

/** The one place a match is declared over, so it can only happen once. */
function over(
  room: Room,
  winner: MatchOver["winner"],
  reason: string,
): void {
  if (room.phase !== "playing") return;
  room.phase = "over";
  io.to(room.code).emit("match:over", {
    winner,
    reason,
    impostorId: room.impostorId ?? "",
    scores: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      points: room.scores.get(player.id) ?? 0,
      out: room.out.has(player.id),
    })),
  });

  // Fire and forget, always after the players have their result: a database
  // hiccup must not be able to take the socket loop down, and nobody is waiting
  // on the write to see the scoreboard.
  void recordMatch(room, winner, reason).catch((error) =>
    console.error("recording the match failed:", error),
  );
}

/**
 * Writes the finished match, one row per seat. Every point in the game comes
 * from a catch, so a seat's catches are its score divided by what a catch was
 * worth there — no separate tally has to be carried through the match.
 */
async function recordMatch(
  room: Room,
  winner: MatchOver["winner"],
  reason: string,
): Promise<void> {
  await prisma.match.create({
    data: {
      winner,
      reason,
      players: {
        create: room.players.map((player) => {
          const impostor = player.id === room.impostorId;
          const points = room.scores.get(player.id) ?? 0;
          return {
            userId: player.userId,
            role: impostor ? "impostor" : "survivor",
            points,
            catches: Math.round(
              points / (impostor ? IMPOSTOR_POINTS : SURVIVOR_POINTS),
            ),
            caught: room.out.has(player.id),
            won: impostor ? winner === "impostor" : winner === "survivors",
          };
        }),
      },
    },
  });
}

/** Take a survivor out: they stop being seen, felt, and taggable. */
function knockOut(room: Room, player: LobbyPlayer): void {
  room.out.add(player.id);
  tracks.delete(player.id);
  missions.delete(player.id);
  io.to(room.code).emit("match:caught", {
    victimId: player.id,
    victimName: player.name,
    byImpostor: true,
  });
}

/**
 * Who has whose collar. Two players within CATCH_M are touching, and one of
 * them is taken. An invisible survivor cannot be seen or caught, so they are
 * the one who does the taking — and that ends the match on the spot. Anyone
 * else inside the impostor's reach is simply gone.
 */
function tag(room: Room, now: number): void {
  const impostorId = room.impostorId;
  if (room.phase !== "playing" || !impostorId) return;
  // Five people begin a match standing together; nobody is taken before they
  // have had a chance to spread out.
  if (now - room.startedAt < SAFE_MS) return;

  const eye = tracks.get(impostorId);
  if (!eye || stale(eye, now)) return;

  for (const player of room.players) {
    if (player.id === impostorId || room.out.has(player.id)) continue;
    const track = tracks.get(player.id);
    if (!track || stale(track, now)) continue;
    if (!touching(eye.fix, track.fix)) continue;

    if (track.invisibleUntil > now) {
      const impostor = room.players.find((seat) => seat.id === impostorId);
      room.scores.set(
        player.id,
        (room.scores.get(player.id) ?? 0) + SURVIVOR_POINTS,
      );
      io.to(room.code).emit("match:caught", {
        victimId: impostorId,
        victimName: impostor?.name ?? "The impostor",
        byImpostor: false,
      });
      return over(room, "survivors", `${player.name} tagged the impostor.`);
    }

    room.scores.set(
      impostorId,
      (room.scores.get(impostorId) ?? 0) + IMPOSTOR_POINTS,
    );
    knockOut(room, player);
  }
}

/**
 * Whether the match is over yet. Runs after every fix and again on a slow tick,
 * so a room where nobody is reporting anything still reaches its whistle.
 */
function finish(room: Room, now: number): void {
  if (room.phase !== "playing") return;
  const impostorId = room.impostorId;

  if (!impostorId || !room.players.some((seat) => seat.id === impostorId)) {
    return over(room, "survivors", "The impostor quit.");
  }

  const standing = room.players.filter(
    (player) => player.id !== impostorId && !room.out.has(player.id),
  );
  if (standing.length === 0) {
    return over(room, "impostor", "The impostor caught everyone.");
  }

  if (now - room.startedAt >= MATCH_MS) {
    const mine = room.scores.get(impostorId) ?? 0;
    const theirs = standing.reduce(
      (sum, player) => sum + (room.scores.get(player.id) ?? 0),
      0,
    );
    // A tie goes to the survivors: they are the ones still standing.
    return mine > theirs
      ? over(room, "impostor", "Time — the impostor had more points.")
      : over(room, "survivors", "Time — the survivors held them off.");
  }
}

/**
 * Re-runs the rules across the whole room after one player reports in, because
 * a single new fix can change what several people are allowed to know: it can
 * expose its owner, carry someone into the impostor's vision, put two players
 * close enough to feel each other, or finish a mission.
 */
function announce(room: Room, now: number): void {
  for (const player of room.players) {
    const track = tracks.get(player.id);
    if (!track) continue;

    const exposed = exposedAt(track, now);
    if (exposed !== track.exposed) {
      track.exposed = exposed;
      io.to(player.id).emit("match:exposed", { exposed });
    }
  }

  handOut(room, now);

  const impostorId = room.impostorId;
  const eye = impostorId ? tracks.get(impostorId) : undefined;
  if (impostorId && eye) {
    const seen: Sighted[] = [];
    for (const player of room.players) {
      if (player.id === impostorId) continue;
      const track = tracks.get(player.id);
      if (!track) continue;
      // A phone that has gone quiet is not a dot on the map any more.
      if (stale(track, now)) continue;
      // A mission's reward outranks both the box and an exposure.
      const hidden = track.invisibleUntil > now;
      if (!hidden && (track.exposed || inVision(eye.fix, track.fix))) {
        seen.push({
          id: player.id,
          name: player.name,
          lat: track.fix.lat,
          lng: track.fix.lng,
          exposed: track.exposed,
        });
      }
    }
    io.to(impostorId).emit("match:sighted", seen);
  }

  for (const player of room.players) {
    const track = tracks.get(player.id);
    if (!track) continue;

    const near = room.players.some((other) => {
      if (other.id === player.id) return false;
      const theirs = tracks.get(other.id);
      return (
        theirs !== undefined && !stale(theirs, now) && feelsNear(track.fix, theirs.fix)
      );
    });

    if (near !== track.near) {
      track.near = near;
      io.to(player.id).emit("match:nearby", { near });
    }
  }

  tag(room, now);
  finish(room, now);
}

/**
 * A player whose phone has gone quiet is not a dot any more: past STALE_MS
 * their last fix is dropped outright, and the world is told, so a match in
 * which nobody reports anything still clears its ghosts. A phone that resumes
 * simply starts over from its next fix.
 */
function sweep(room: Room, now: number): void {
  if (room.phase !== "playing") return;
  let dropped = false;
  for (const player of room.players) {
    const track = tracks.get(player.id);
    if (!track || !stale(track, now)) continue;
    tracks.delete(player.id);
    missions.delete(player.id);
    dropped = true;
  }
  if (dropped) announce(room, now);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

// Identity comes from the session cookie on the handshake, never from anything
// the client sends. Anonymous connections stay allowed so the landing page can
// show a connection badge; only lobby actions require an account.
io.use(async (socket, next) => {
  socket.data.code = null;
  const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);

  if (!token) {
    socket.data.viewer = null;
    return next();
  }

  try {
    socket.data.viewer = await viewerFromToken(token);
  } catch (error) {
    // A database problem must not stop the page from loading; the player is
    // simply treated as signed out and lobby actions say so.
    console.error("session lookup failed:", error);
    socket.data.viewer = null;
  }
  next();
});

io.on("connection", (socket) => {
  function leave(): void {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    socket.data.code = null;
    tracks.delete(socket.id);
    missions.delete(socket.id);
    if (!room) return;

    room.players = room.players.filter((player) => player.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    // The lobby must not be stranded when the host walks away.
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
      room.players[0] = { ...room.players[0], isHost: true };
    }

    io.to(room.code).emit("lobby:state", snapshot(room));

    // A match loses its impostor or its last survivor here.
    finish(room, Date.now());
  }

  socket.on("lobby:create", (ack?: (reply: LobbyReply) => void) => {
    const done = replyTo<LobbyReply>(ack);
    const viewer = socket.data.viewer;
    if (!viewer) return done({ ok: false, error: "signed_out" });
    if (socket.data.code) return done({ ok: false, error: "in_lobby" });

    const room: Room = {
      code: newCode(),
      hostId: socket.id,
      impostorId: null,
      players: [
        {
          id: socket.id,
          userId: viewer.id,
          name: viewer.username,
          isHost: true,
        },
      ],
      phase: "lobby",
      startedAt: 0,
      scores: new Map(),
      out: new Set(),
    };

    rooms.set(room.code, room);
    socket.data.code = room.code;
    socket.join(room.code);

    done({ ok: true, lobby: snapshot(room) });
  });

  socket.on(
    "lobby:join",
    (payload: unknown, ack?: (reply: LobbyReply) => void) => {
      const done = replyTo<LobbyReply>(ack);
      const viewer = socket.data.viewer;
      if (!viewer) return done({ ok: false, error: "signed_out" });
      if (socket.data.code) return done({ ok: false, error: "in_lobby" });

      const sent =
        typeof payload === "object" && payload !== null
          ? (payload as { code?: unknown }).code
          : undefined;
      const code = typeof sent === "string" ? sent.trim().toUpperCase() : "";
      const room = code ? rooms.get(code) : undefined;

      if (!room) return done({ ok: false, error: "unknown_code" });
      if (room.phase !== "lobby") return done({ ok: false, error: "started" });
      if (room.players.length >= LOBBY_CAPACITY) {
        return done({ ok: false, error: "full" });
      }
      // Five tabs in one browser are five sockets sharing one session cookie:
      // one account must still get only one seat in a match.
      if (room.players.some((seat) => seat.userId === viewer.id)) {
        return done({ ok: false, error: "already_seated" });
      }

      room.players.push({
        id: socket.id,
        userId: viewer.id,
        name: viewer.username,
        isHost: false,
      });
      socket.data.code = room.code;
      socket.join(room.code);

      done({ ok: true, lobby: snapshot(room) });
      socket.to(room.code).emit("lobby:state", snapshot(room));
    },
  );

  socket.on("lobby:leave", leave);

  socket.on("match:start", (ack?: (reply: StartReply) => void) => {
    const done = replyTo<StartReply>(ack);
    if (!socket.data.viewer) return done({ ok: false, error: "signed_out" });

    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    if (!room) return done({ ok: false, error: "not_in_lobby" });
    if (room.phase !== "lobby") return done({ ok: false, error: "started" });
    if (room.hostId !== socket.id) return done({ ok: false, error: "not_host" });
    if (room.players.length < LOBBY_CAPACITY) {
      return done({ ok: false, error: "not_full" });
    }

    room.phase = "playing";
    room.startedAt = Date.now();
    room.scores = new Map(room.players.map((player) => [player.id, 0]));
    room.out = new Set();
    const impostor = room.players[randomInt(room.players.length)];
    room.impostorId = impostor.id;

    // One socket at a time. A broadcast here would hand the whole game away.
    for (const player of room.players) {
      io.to(player.id).emit("match:started", {
        role: player.id === impostor.id ? "impostor" : "survivor",
        lobby: snapshot(room),
      });
    }

    done({ ok: true });
  });

  socket.on(
    "match:position",
    (payload: unknown, ack?: (reply: FixReply) => void) => {
      const done = replyTo<FixReply>(ack);

      const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
      if (room?.phase !== "playing") return done({ ok: false, reason: "out_of_match" });
      if (room.out.has(socket.id)) return done({ ok: false, reason: "caught" });

      const fix = readFix(payload);
      if (!fix) return done({ ok: false, reason: "invalid" });
      if (fix.accuracy > MAX_ACCURACY_M) {
        return done({ ok: false, reason: "accuracy" });
      }

      const now = Date.now();
      const previous = tracks.get(socket.id);
      if (previous && !plausibleMove(previous.fix, fix, now - previous.at)) {
        return done({ ok: false, reason: "speed" });
      }

      tracks.set(socket.id, nextTrack(previous ?? null, fix, now));
      done({ ok: true, reporting: reporting(room) });

      announce(room, now);
    },
  );

  socket.on("disconnect", leave);
});

// A match in which nobody reports anything would otherwise never reach its
// whistle, because a fix is what normally drives the end conditions. The sweep
// also keeps stale tracks from lingering as ghost dots when the room goes quiet.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    sweep(room, now);
    finish(room, now);
  }
}, 5_000);

httpServer.listen(port, () => {
  console.log(`> Impostor Hunt ready on http://${hostname}:${port}`);
});
