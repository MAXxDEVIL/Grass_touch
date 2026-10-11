// Phase 15 check: safety. One account may not hold two seats in the same match
// — five tabs in one browser are five sockets sharing one session cookie, so a
// second socket with the same account must be turned away while a different
// account may still sit down. The other half of the phase (a stale track is
// dropped, not just skipped) is pinned by the same pure predicate the server
// sweeps with.
//   node --env-file=.env scripts/check-safety.mjs
import { io } from "socket.io-client";

const base = process.env.URL ?? "http://localhost:3000";
const names = ["safety1", "safety2"];
const password = "correct-horse-battery";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const { prisma } = await import("../src/lib/db.ts");
await prisma.user.deleteMany({ where: { username: { in: names } } });

const cookies = [];
for (const name of names) {
  const response = await fetch(new URL("/api/auth/register", base), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: name, password }),
  });
  const cookie = response.headers
    .getSetCookie()
    .find((header) => header.startsWith("ih_session="));
  assert(cookie, `register did not set a cookie for ${name}`);
  cookies.push(cookie.split(";")[0]);
}

const open = (cookie) =>
  cookie
    ? io(base, {
        extraHeaders: { cookie },
        transportOptions: {
          polling: { extraHeaders: { cookie } },
          websocket: { extraHeaders: { cookie } },
        },
      })
    : io(base);

const connect = (socket, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: connect timed out`)),
      10_000,
    );
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${label}: ${error.message}`));
    });
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const emit = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ack for ${event}`)),
      10_000,
    );
    const done = (reply) => {
      clearTimeout(timer);
      resolve(reply);
    };
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });

// --- one account, one seat ------------------------------------------------
const first = open(cookies[0]);
await connect(first, names[0]);
const created = await emit(first, "lobby:create");
assert(created.ok === true, `create failed: ${JSON.stringify(created)}`);
const code = created.lobby.code;

// The same account on a second socket is the same match on a second tab.
const secondTab = open(cookies[0]);
await connect(secondTab, "second tab");
const refused = await emit(secondTab, "lobby:join", { code });
assert(
  refused.ok === false && refused.error === "already_seated",
  `a duplicate seat said ${JSON.stringify(refused)}`,
);
secondTab.close();

// The room is not the guard — the account is: a different account may sit down.
const guest = open(cookies[1]);
await connect(guest, names[1]);
const joined = await emit(guest, "lobby:join", { code });
assert(joined.ok === true, `a fresh account was refused: ${JSON.stringify(joined)}`);

// --- the other half: a stale track is dropped by the same rule it is judged by
const { STALE_MS, nextTrack, stale } = await import("../src/lib/match-rules.ts");
const { LOBBY_ERRORS } = await import("../src/lib/realtime.ts");

const heard = nextTrack(null, { lat: 51.5, lng: -0.12, accuracy: 8 }, 1000);
assert(stale(heard, 1000 + STALE_MS) === false, "a fresh fix reads as stale");
assert(stale(heard, 1000 + STALE_MS + 1) === true, "a stale fix reads as fresh");

// The client must be able to say why the seat was refused.
assert(
  typeof LOBBY_ERRORS.already_seated === "string" &&
    LOBBY_ERRORS.already_seated.length > 0,
  "the client has no message for a duplicate seat",
);

guest.close();
first.close();

await prisma.user.deleteMany({ where: { username: { in: names } } });

console.log(
  "ok — one seat an account per match, a different account still joins, and the stale sweep's drop predicate holds",
);
process.exit(0);