// The single source of truth for the realtime contract, shared by the server
// (server.ts) and the browser.

import type { Socket } from "socket.io-client";

export const LOBBY_CAPACITY = 5;

export type Role = "impostor" | "survivor";

export const LOBBY_ERRORS = {
  signed_out: "Sign in before you play.",
  in_lobby: "You are already in a lobby.",
  not_in_lobby: "Join a lobby first.",
  unknown_code: "No lobby with that code.",
  full: "That lobby is full.",
  already_seated: "You already have a seat in that match.",
  started: "That match has already started.",
  not_host: "Only the host can start the match.",
  not_full: `A match needs ${LOBBY_CAPACITY} players.`,
} as const;

export type LobbyErrorCode = keyof typeof LOBBY_ERRORS;

export interface LobbyPlayer {
  /** The socket id. A player is a connection, not an account. */
  id: string;
  /** The account this player signed in with. */
  userId: string;
  name: string;
  isHost: boolean;
}

/** What every player in a lobby is allowed to see. Deliberately has no role. */
export interface LobbySnapshot {
  code: string;
  hostId: string;
  capacity: number;
  players: LobbyPlayer[];
}

export type LobbyReply =
  | { ok: true; lobby: LobbySnapshot }
  | { ok: false; error: LobbyErrorCode };

export type StartReply = { ok: true } | { ok: false; error: LobbyErrorCode };

/** A position as the phone reports it, before anyone has judged it. */
export interface Fix {
  lat: number;
  lng: number;
  /** The device's own confidence radius, in metres. */
  accuracy: number;
}

/**
 * Consumer GPS is 5–20 m outdoors and worse between buildings, while the whole
 * game happens in a 40 m box. Past this, a fix says less about where a player
 * is than the rules themselves do, so it is refused.
 */
export const MAX_ACCURACY_M = 30;

// The rules of the hunt. They live here rather than in server.ts because the
// browser needs the same numbers to draw and explain them.

/** One degree of latitude, in metres. A degree of longitude shrinks by cos(lat). */
export const METRES_PER_DEGREE = 111_320;

/** The impostor's view: a 40 x 40 m box centred on them. */
export const VISION_M = 40;

/** How close someone has to be before you feel them. */
export const HEARTBEAT_M = 10;

/** Stand still this long and the impostor can see you wherever you are. */
export const IDLE_LIMIT_MS = 5 * 60 * 1000;

/** Faster than a fast run. A longer leap than this allows is a jump, not travel. */
export const MAX_SPEED_MPS = 8;

/** Further than this from where they last were counts as having moved. */
export const MOVED_M = 20;

/**
 * Touching. This close and one of you has the other; the server decides which,
 * and it decides it the same way for a phone and a laptop.
 *
 * shortcut: the tag radius is 6 m and the pulse radius 10 m, both raw distances
 * with no allowance for GPS error, so the pulse is a warning the tag can beat
 * on a bad fix. Widen the gap, or add both accuracies to the tag, once real
 * phones show how often a tag is missed at arm's length.
 */
export const CATCH_M = 6;

/**
 * What a tag is worth. The hunt pays five times a survivor's, because the
 * impostor has to walk into everyone; a survivor only has to be lucky once.
 */
export const IMPOSTOR_POINTS = 10;
export const SURVIVOR_POINTS = 2;

/**
 * No tags at all for this long after the start. A match begins with five people
 * standing together, and without a head start the impostor would have the whole
 * room before anyone had moved.
 */
export const SAFE_MS = 30_000;

/** The match clock. At the whistle, whoever has more points takes it. */
export const MATCH_MS = 15 * 60 * 1000;

export const FIX_ERRORS = {
  out_of_match: "That match is not running.",
  invalid: "Your device sent a position that makes no sense.",
  accuracy: `Your GPS is too vague — better than ${MAX_ACCURACY_M} m is needed.`,
  speed: "That was further than you could have moved — check your GPS.",
  caught: "You are out of this match.",
} as const;

export type FixErrorCode = keyof typeof FIX_ERRORS;

/** A player the impostor can currently see. */
export interface Sighted {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Seen from anywhere, because they stood still too long. */
  exposed: boolean;
}

/** The three things a survivor can be asked to do. */
export type MissionKind = "walk" | "vanish" | "approach";

/** What finishing a mission buys: this long with nobody able to see you. */
export const INVISIBLE_MS = 45_000;

/** A mission as the survivor holding it sees it. */
export interface Mission {
  /** New on every issue, so a replacement is never read as an update. */
  id: string;
  kind: MissionKind;
  /** The one line the survivor reads. */
  text: string;
  /** The number that decides it: metres to walk, or metres to be from people. */
  target: number;
  /** How far along they are, in the same metres. */
  progress: number;
}

export type FixReply =
  | { ok: true; reporting: number }
  | { ok: false; reason: FixErrorCode };

/** How a match ended, and what everyone is owed for it. */
export interface MatchOver {
  winner: "impostor" | "survivors";
  /** One line the players can read. */
  reason: string;
  /** Now that it no longer matters, everyone learns who it was. */
  impostorId: string;
  scores: { id: string; name: string; points: number; out: boolean }[];
}

export interface ClientToServerEvents {
  "lobby:create": (ack: (reply: LobbyReply) => void) => void;
  "lobby:join": (
    payload: { code: string },
    ack: (reply: LobbyReply) => void,
  ) => void;
  "lobby:leave": () => void;
  "match:start": (ack: (reply: StartReply) => void) => void;
  /** Sent at roughly the device's own update rate, whether or not it is usable. */
  "match:position": (fix: Fix, ack: (reply: FixReply) => void) => void;
}

export interface ServerToClientEvents {
  "lobby:state": (lobby: LobbySnapshot) => void;
  /** Sent to one socket at a time. Roles are never broadcast. */
  "match:started": (payload: { role: Role; lobby: LobbySnapshot }) => void;
  /** Sent when someone close enough to feel comes or goes. Anyone can feel it. */
  "match:nearby": (payload: { near: boolean }) => void;
  /** Only ever sent to the impostor: who is inside their vision. */
  "match:sighted": (players: Sighted[]) => void;
  /** Sent when standing still too long starts or stops being true. */
  "match:exposed": (payload: { exposed: boolean }) => void;
  /** The survivor's own objective, on issue and whenever progress really moves. */
  "match:mission": (mission: Mission) => void;
  /** A mission was completed: nothing can see them for this long. */
  "match:invisible": (payload: { forMs: number }) => void;
  /** Someone was tagged out. Broadcast: who is left is everyone's business. */
  "match:caught": (payload: {
    victimId: string;
    victimName: string;
    /** True when the impostor did it, false when a survivor got the impostor. */
    byImpostor: boolean;
  }) => void;
  /** Once, when the match ends, with everyone's points. */
  "match:over": (match: MatchOver) => void;
}

/** The typed connection, from the browser's side. */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
