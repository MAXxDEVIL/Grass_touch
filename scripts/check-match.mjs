// The match check: the rules of a running game. Lobby capacity, host control
// and host handover (phase 4); position judging (phase 5); the movement cap,
// exposure, proximity and vision (phase 6); missions with the 45-second escape
// they buy (phase 7); catching either way, scoring and the end of a match
// (phase 8); and the finished match being written down where the leaderboard
// reads it (phase 9), including where each player stands on it (phase 13), plus
// the promise that a role is only ever told to the player who owns it.
//   node --env-file=.env scripts/check-match.mjs
import { io } from "socket.io-client";

const base = process.env.URL ?? "http://localhost:3000";
const names = ["checkbot1", "checkbot2", "checkbot3", "checkbot4", "checkbot5"];
const password = "correct-horse-battery";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- the rules themselves, with no sockets in the way -----------------------
// The idle clock takes five real minutes to reach, so the decision is tested
// here directly; the socket checks further down only test the wiring.
const {
  exposedAt,
  feelsNear,
  inVision,
  metresApart,
  nextTrack,
  plausibleMove,
  STALE_MS,
  stale,
  touching,
} = await import("../src/lib/match-rules.ts");
const { CATCH_M, IMPOSTOR_POINTS, SAFE_MS, SURVIVOR_POINTS } = await import(
  "../src/lib/realtime.ts"
);

const spot = { lat: 51.5074, lng: -0.1278, accuracy: 8 };
/** A point the given number of metres due north of `from`. */
const at = (metres, from = spot) => ({
  ...from,
  lat: from.lat + metres / 111_320,
});

assert(Math.abs(metresApart(spot, at(100)) - 100) < 0.1, "metresApart is wrong");

// A step someone could walk is travel; a leap across town is not.
assert(plausibleMove(spot, at(5), 1000) === true, "a short step was called a jump");
assert(plausibleMove(spot, at(500), 1000) === false, "a 500 m step was allowed");
// That allowance is per elapsed second, so a burst of fixes buys no distance.
assert(plausibleMove(spot, at(40), 10) === false, "a 40 m step in 10 ms was allowed");
// Two vague fixes may honestly sit 55 m apart, so their own error is added in.
assert(
  plausibleMove({ ...spot, accuracy: 30 }, { ...at(55), accuracy: 30 }, 1000) === true,
  "two vague fixes 55 m apart were called a jump",
);

// The idle clock resets on a real move, not on GPS wander.
const settled = nextTrack(null, spot, 0);
const wobble = nextTrack(settled, at(5), 1000);
assert(wobble.movedAt === 0, "GPS wander reset the idle clock");
assert(wobble.anchor.lat === settled.anchor.lat, "GPS wander moved the anchor");
const stride = nextTrack(wobble, at(30), 2000);
assert(stride.movedAt === 2000, "a 30 m stride did not reset the idle clock");

assert(exposedAt(stride, 2000 + 299_000) === false, "exposed before the limit");
assert(exposedAt(stride, 2000 + 301_000) === true, "not exposed after the limit");
// And moving again hides them.
assert(
  exposedAt(nextTrack(stride, at(60), 400_000), 400_000) === false,
  "walking again did not clear an exposure",
);

// Vision is the 40 x 40 m box, not a 40 m radius: 25 m ahead is outside it.
assert(inVision(spot, at(15)) === true, "15 m ahead is not in vision");
assert(inVision(spot, at(25)) === false, "25 m ahead is in vision");
const east = (metres) => ({
  ...spot,
  lng: spot.lng + metres / (111_320 * Math.cos((spot.lat * Math.PI) / 180)),
});
assert(inVision(spot, east(15)) === true, "15 m to the side is not in vision");
assert(inVision(spot, east(25)) === false, "25 m to the side is in vision");

// The heartbeat is the spec's 10 m, with nothing added for GPS error.
assert(feelsNear(spot, at(5)) === true, "5 m is not close");
assert(feelsNear(spot, at(15)) === false, "15 m is close");

// Touching is the tag radius, inside the pulse radius, so the pulse is always
// the warning that arrives first.
assert(touching(spot, at(CATCH_M - 1)) === true, "a survivor in reach is not caught");
assert(touching(spot, at(CATCH_M + 3)) === false, "a survivor out of reach is caught");

// A phone that has gone quiet is not worth judging on: a dead phone's last
// position must not be somewhere a survivor can still be caught.
const heard = nextTrack(null, spot, 1000);
assert(stale(heard, 1000 + STALE_MS) === false, "a fresh fix reads as stale");
assert(stale(heard, 1000 + STALE_MS + 1) === true, "a stale fix reads as fresh");

// Missions are templates drawn by one function, and can be judged purely.
const { generateMission, missionMet, missionProgress } = await import(
  "../src/lib/missions.ts"
);

// Drawn across the whole probability range, every kind is reachable.
const drawn = new Set();
for (let n = 0; n < 1; n += 0.05) drawn.add(generateMission(spot, () => n).kind);
assert(drawn.size === 3, `generateMission only ever drew ${[...drawn]}`);

const drawKind = (wanted) => {
  for (let n = 0; n < 1; n += 0.05) {
    const mission = generateMission(spot, () => n);
    if (mission.kind === wanted) return mission;
  }
  throw new Error(`generateMission never drew ${wanted}`);
};

for (const kind of ["walk", "vanish", "approach"]) {
  const mission = drawKind(kind);
  assert(mission.target > 0, `${kind} came with no target`);
  assert(
    mission.text.includes(String(mission.target)),
    `${kind} text hides how far`,
  );
  assert(mission.progress === 0, `${kind} starts already complete`);
}

const walking = drawKind("walk");
assert(
  missionProgress(walking, at(200), 0) >= walking.target,
  "walking the target did not count",
);
assert(
  missionProgress(walking, at(20), 200) === 20,
  "walk measures itself from its own anchor",
);
assert(missionMet(walking, walking.target) === true, "a walk at the target was not met");
assert(missionMet(walking, walking.target - 1) === false, "a short walk was met");

const vanishing = drawKind("vanish");
assert(
  missionProgress(vanishing, spot, 90) === 90,
  "vanish ignored the closest player",
);
assert(missionMet(vanishing, vanishing.target) === true, "a stand at the target was not met");
assert(
  missionMet(vanishing, vanishing.target - 1) === false,
  "a too-close stand was met",
);

const approaching = drawKind("approach");
assert(
  missionProgress(approaching, spot, 33) === 33,
  "approach ignored the closest player",
);
assert(missionMet(approaching, approaching.target) === true, "an approach at the target was not met");
assert(
  missionMet(approaching, approaching.target + 1) === false,
  "a too-far approach was met",
);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — run with --env-file=.env");
}

// --- five real accounts -----------------------------------------------------
// The check reads the database through the app's own client, not a second one:
// a raw pg client sitting alongside it produced intermittent "bind message
// supplies 1 parameters, but prepared statement requires 0" failures.
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

// --- socket helpers --------------------------------------------------------
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

const nextEvent = (socket, event, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: timed out waiting for ${event}`)),
      10_000,
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Like nextEvent, but for an event that repeats until one matches. */
const waitFor = (socket, event, keep) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for a ${event} that matched`)),
      10_000,
    );
    const handler = (payload) => {
      if (!keep(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const players = cookies.map(open);
await Promise.all(players.map((socket, index) => connect(socket, names[index])));

// --- an anonymous player cannot even open a lobby --------------------------
const anonymous = open(null);
await connect(anonymous, "anonymous");
const refused = await emit(anonymous, "lobby:create");
assert(
  refused.ok === false && refused.error === "signed_out",
  `anonymous create said ${JSON.stringify(refused)}`,
);
// Kept open: this socket is not in a match, which is what the position checks
// below need.

// --- the host opens a lobby ------------------------------------------------
const created = await emit(players[0], "lobby:create");
assert(created.ok === true, `create failed: ${JSON.stringify(created)}`);
const { code } = created.lobby;
assert(/^[A-Z0-9]{4}$/.test(code), `unexpected code ${code}`);
assert(created.lobby.players.length === 1, "the creator should be alone");
assert(created.lobby.players[0].isHost === true, "the creator should be host");
assert(created.lobby.capacity === 5, `expected capacity 5, got ${created.lobby.capacity}`);

const nonsense = await emit(players[1], "lobby:join", { code: "ZZZZ" });
assert(
  nonsense.ok === false && nonsense.error === "unknown_code",
  `a bad code said ${JSON.stringify(nonsense)}`,
);

// --- the other four fill the slots, the host watching each one land --------
for (let index = 1; index < players.length; index += 1) {
  const hostSees = nextEvent(players[0], "lobby:state", "host");
  const joined = await emit(players[index], "lobby:join", { code });
  assert(joined.ok === true, `join ${index} failed: ${JSON.stringify(joined)}`);
  assert(
    joined.lobby.players.length === index + 1,
    `join ${index} saw ${joined.lobby.players.length} players`,
  );
  const broadcast = await hostSees;
  assert(
    broadcast.players.length === index + 1,
    `the host was told about ${broadcast.players.length} players`,
  );
}

// --- and a sixth player is turned away -------------------------------------
const sixth = open(cookies[0]);
await connect(sixth, "sixth");
await emit(sixth, "lobby:join", { code: "ZZZZ" });
const overCapacity = await emit(sixth, "lobby:join", { code });
assert(
  overCapacity.ok === false && overCapacity.error === "full",
  `a sixth player said ${JSON.stringify(overCapacity)}`,
);
sixth.close();

// --- only the host may start ----------------------------------------------
const guestStart = await emit(players[1], "match:start");
assert(
  guestStart.ok === false && guestStart.error === "not_host",
  `a guest starting said ${JSON.stringify(guestStart)}`,
);

// --- the host starts, and every player is told only their own role ---------
const roles = players.map((socket) =>
  nextEvent(socket, "match:started", "role"),
);
const started = await emit(players[0], "match:start");
assert(started.ok === true, `start failed: ${JSON.stringify(started)}`);
// The scatter window and the match clock both run from the server's start.
const startedAt = Date.now();

const told = await Promise.all(roles);
const mine = told.map((payload) => payload.role);

assert(
  mine.filter((role) => role === "impostor").length === 1,
  `expected exactly one impostor, got ${JSON.stringify(mine)}`,
);
assert(
  mine.filter((role) => role === "survivor").length === 4,
  `expected four survivors, got ${JSON.stringify(mine)}`,
);

for (const payload of told) {
  assert(payload.lobby.players.length === 5, "the role came with a wrong roster");
  assert(
    payload.lobby.players.every((player) => !("role" in player)),
    "a roster entry leaked a role",
  );
  assert(
    !JSON.stringify(payload.lobby).includes("impostor"),
    "the lobby snapshot mentions which player is the impostor",
  );
}

// --- phase 7: a mission comes to every survivor, and never the impostor -----
// Missions are handed out from the very first fix, so these listeners must be
// up before any later position is sent (the roundup below is where most of the
// walking happens).
const handedOut = new Map();
let impostorMission = null;
// Every survivor who finishes a mission goes invisible, and an invisible
// survivor tags the impostor back instead of being caught — so the phase 8
// catch needs an invisibility-free crowd. Recorded rather than asserted here
// because the walker is meant to earn one in phase 7.
const wentInvisible = new Set();
players.forEach((socket, index) => {
  socket.on("match:invisible", () => wentInvisible.add(socket.id));
  socket.on("match:mission", (mission) => {
    if (mine[index] === "survivor") handedOut.set(socket.id, mission);
    else impostorMission = mission;
  });
});

// --- positions: judged on arrival, never stored on trust -------------------
const fix = { lat: 51.5074, lng: -0.1278, accuracy: 8 };

const idle = await emit(anonymous, "match:position", fix);
assert(
  idle.ok === false && idle.reason === "out_of_match",
  `a socket in no match said ${JSON.stringify(idle)}`,
);

const firstFix = await emit(players[0], "match:position", fix);
assert(firstFix.ok === true, `a good fix said ${JSON.stringify(firstFix)}`);
assert(firstFix.reporting === 1, `expected 1 reporting, got ${firstFix.reporting}`);

// The same rally point rather than a nearby one: the first fix a survivor ever
// sends becomes the anchor of its first mission, and a mission pays out once
// its holder has been 20 m from that anchor. An off-spot first fix here puts a
// survivor's start point 11 m from the rally, which the 12 m scatter below then
// turns into a 23 m journey — enough to finish a mission mid-catch, turn
// invisible, and tag the impostor instead of being caught.
const secondFix = await emit(players[1], "match:position", fix);
assert(secondFix.ok === true, `the second fix said ${JSON.stringify(secondFix)}`);
assert(secondFix.reporting === 2, `expected 2 reporting, got ${secondFix.reporting}`);

for (const [label, payload, reason] of [
  ["a 45 m fix", { ...fix, accuracy: 45 }, "accuracy"],
  ["zero accuracy", { ...fix, accuracy: 0 }, "invalid"],
  ["latitude 999", { ...fix, lat: 999 }, "invalid"],
  ["a string latitude", { lat: "51.5", lng: -0.1, accuracy: 8 }, "invalid"],
  // Number(null) is 0, so a coercion-based check would happily place this at
  // null island. It must not.
  ["null coordinates", { lat: null, lng: null, accuracy: 8 }, "invalid"],
  ["no coordinates", {}, "invalid"],
  ["a null payload", null, "invalid"],
]) {
  const rejected = await emit(players[2], "match:position", payload);
  assert(
    rejected.ok === false && rejected.reason === reason,
    `${label} said ${JSON.stringify(rejected)}`,
  );
}

const thirdFix = await emit(players[2], "match:position", fix);
assert(
  thirdFix.ok === true && thirdFix.reporting === 3,
  `seven refused fixes were stored: ${JSON.stringify(thirdFix)}`,
);

// --- a client that wants no reply must not take the server with it ---------
const silent = open(cookies[4]);
await connect(silent, "silent");
silent.emit("lobby:create");
silent.emit("lobby:join");
silent.emit("match:start");
silent.emit("match:position");
await wait(250);

const alive = await emit(players[0], "match:position", fix);
assert(alive.ok === true, "the server stopped answering after a callback-less emit");
silent.close();

// --- phase 6: movement, exposure, proximity and vision --------------------
// Every seat takes the same position, so the tests start from a known map:
// everyone within feeling distance, and all four survivors in the impostor's
// vision. Later fixes move a few tens of metres, which the cap allows.
for (const socket of players) {
  const landed = await emit(socket, "match:position", spot);
  assert(landed.ok === true, `rounding everyone up said ${JSON.stringify(landed)}`);
}

const impostorIndex = mine.indexOf("impostor");
const impostor = players[impostorIndex];
const walkerIndex = mine.findIndex((role) => role === "survivor");
const walker = players[walkerIndex];

// A survivor is never told who the impostor can see.
let leaked = null;
walker.on("match:sighted", (list) => {
  leaked = list;
});

// All five are on the same spot, so all four survivors are in vision. The
// walker re-sends its own fix only to make the server re-run the rules.
const seenAll = waitFor(impostor, "match:sighted", (list) => list.length === 4);
await emit(walker, "match:position", spot);
const all = await seenAll;
assert(all.length === 4, `the impostor sees ${all.length} of 4 survivors`);
assert(
  !all.some((player) => player.id === impostor.id),
  "the impostor is in their own sighted list",
);
assert(
  all.every((player) => typeof player.name === "string" && player.name.length > 0),
  "a sighted survivor came through with no name to hunt by",
);
await wait(150);
assert(leaked === null, "a survivor was sent the impostor's vision");

// A leap of 5 km between two fixes is refused, and the bad fix is not stored.
const jumped = await emit(walker, "match:position", at(5000));
assert(
  jumped.ok === false && jumped.reason === "speed",
  `a 5 km jump said ${JSON.stringify(jumped)}`,
);

// 38 m north is past half of the 40 m box, so it leaves the vision, and past
// 10 m, so it ends the pulse. The wait is what buys the distance: the cap
// allows both accuracies plus 8 m/s, so a 38 m walk needs a few seconds of it.
// setTimeout only ever fires late, so the allowance can only grow.
const gone = waitFor(walker, "match:nearby", (payload) => payload.near === false);
const seenFewer = waitFor(impostor, "match:sighted", (list) => list.length === 3);
await wait(3000);
const went = await emit(walker, "match:position", at(38));
assert(went.ok === true, `a 38 m walk said ${JSON.stringify(went)}`);
assert((await gone).near === false, "the walker still feels someone");
const fewer = await seenFewer;
assert(fewer.length === 3, `vision still lists ${fewer.length}`);
assert(
  !fewer.some((player) => player.id === walker.id),
  "a survivor 38 m away is still in the impostor's vision",
);

// --- the three survivors who are not the walker move off the rally point ----
// Each takes its own bearing 12 m out: far enough that nobody touches anyone,
// and close enough that none of their missions can complete (the journey rule
// needs 20 m), so none of them can turn invisible on their own.
const crowd = players.filter(
  (socket, index) => mine[index] === "survivor" && socket !== walker,
);
assert(crowd.length === 3, `expected 3 other survivors, got ${crowd.length}`);
const scattered = [at(-12), east(12), east(-12)];
for (const [index, socket] of crowd.entries()) {
  const sent = await emit(socket, "match:position", scattered[index]);
  assert(sent.ok === true, `scattering a survivor said ${JSON.stringify(sent)}`);
}

// --- phase 7: a completed mission buys 45 seconds nobody can see you --------
// The walker's objective, already drawn while the roundup ran, and its holder
// has long since earned the right to finish it (the journey rule below needs
// only 20 m, and the walker is 38 m from where the mission was issued). One
// destination completes whatever it is: walk and vanish both want to be far,
// and 140 m north clears any target from any anchor; approach just wants to be
// within 10 m of the rest of the room, who are all still on the exact same spot.
let mission = handedOut.get(walker.id);
assert(mission, "the walker never received a mission");

const survivorSockets = players.filter(
  (socket) => mine[players.indexOf(socket)] === "survivor",
);
assert(
  survivorSockets.every((socket) => handedOut.has(socket.id)),
  "a survivor was never handed a mission",
);
assert(impostorMission === null, "the impostor was handed a mission");

const destination = at(mission.kind === "approach" ? 10 : 140);
const travel = Math.abs((mission.kind === "approach" ? 10 : 140) - 38);
// The cap allows 8 m/s plus both accuracies, so the wait is what buys distance.
await wait((Math.ceil((travel - 16) / 8) + 2) * 1000);

const invisible = waitFor(walker, "match:invisible", () => true);
const afterEscape = waitFor(impostor, "match:sighted", () => true);
const landed = await emit(walker, "match:position", destination);
assert(landed.ok === true, `completing a mission said ${JSON.stringify(landed)}`);
assert(
  (await invisible).forMs === 45_000,
  "a completed mission did not buy 45 seconds",
);

// For the whole of that escape the impostor cannot see them — not even from
// inside their own box, which is where the walker ends up after an approach.
const stillSighted = await afterEscape;
assert(
  !stillSighted.some((player) => player.id === walker.id),
  "an invisible survivor is still in the impostor's vision",
);

// The completion re-arms the loop: the next fix draws a fresh objective, and
// because a mission only pays out once its holder has walked 20 m from the
// point it was issued, that replacement is handed out unfinished rather than
// being finished on the spot.
const replaced = waitFor(walker, "match:mission", (next) => next.id !== mission.id);
await emit(walker, "match:position", destination);
const fresh = await replaced;
assert(fresh.target > 0 && fresh.text.length > 0, "the replacement mission is empty");

// --- phase 8: catching, points and the end of a match ----------------------
// Five people start on one spot, so nothing may be caught while they scatter.
await wait(Math.max(0, startedAt + SAFE_MS + 500 - Date.now()));

// The impostor's own track must be fresh for the server to trust the tag.
const refreshed = await emit(impostor, "match:position", spot);
assert(refreshed.ok === true, `the impostor refreshing said ${JSON.stringify(refreshed)}`);

// Nobody but the walker has any business being invisible, whose escape was
// earned in phase 7 on purpose. Anyone else means the fixture moved a survivor
// far enough to complete a mission, and the catch below would be ambiguous.
for (const socket of crowd) {
  assert(
    !wentInvisible.has(socket.id),
    `${names[players.indexOf(socket)]} turned invisible — the scatter gave it a mission`,
  );
}

// Stepping onto a survivor in the open: the impostor drops 7 m south, putting
// them 5 m from the survivor 12 m south — inside the 6 m radius with room for
// a GPS wobble and for the float of the metre conversion.
const caughtNews = nextEvent(impostor, "match:caught", "a survivor caught");
await wait(600);
const catching = await emit(impostor, "match:position", at(-7));
assert(catching.ok === true, `the catch said ${JSON.stringify(catching)}`);
const caught = await caughtNews;
assert(
  caught.byImpostor === true && caught.victimId === crowd[0].id,
  `the impostor's first catch was ${JSON.stringify(caught)}`,
);

// And they are out: the server refuses anything more from them.
const ghosted = await emit(crowd[0], "match:position", at(-12));
assert(
  ghosted.ok === false && ghosted.reason === "caught",
  `a caught survivor's fix said ${JSON.stringify(ghosted)}`,
);

// The other way round: the walker is still invisible from the escape, and an
// invisible survivor cannot be seen or caught, so touching the impostor wins
// the match on the spot. The impostor does the walking, which is the long haul.
await emit(walker, "match:position", destination);
const gap = metresApart(at(-7), destination);
await wait((Math.ceil((gap - 16) / 8) + 2) * 1000);

const impostorCaught = nextEvent(impostor, "match:caught", "the impostor caught");
const finished = nextEvent(impostor, "match:over", "the end of the match");
const closed = await emit(impostor, "match:position", destination);
assert(closed.ok === true, `closing on the walker said ${JSON.stringify(closed)}`);

const taggedBack = await impostorCaught;
assert(
  taggedBack.victimId === impostor.id,
  "the impostor's own tag is not the one recorded",
);
assert(
  taggedBack.byImpostor === false,
  "the winning tag was credited to the impostor",
);

const result = await finished;
assert(result.winner === "survivors", `the match ended as ${result.winner}`);
assert(result.impostorId === impostor.id, "the summary names the wrong impostor");
const scored = new Map(result.scores.map((row) => [row.id, row]));
assert(scored.size === 5, `the summary lists ${scored.size} players`);
assert(
  scored.get(impostor.id)?.points === IMPOSTOR_POINTS,
  `the impostor's catch scored ${scored.get(impostor.id)?.points}, not ${IMPOSTOR_POINTS}`,
);
assert(
  scored.get(walker.id)?.points === SURVIVOR_POINTS,
  `the winning tag scored ${scored.get(walker.id)?.points}, not ${SURVIVOR_POINTS}`,
);
assert(scored.get(crowd[0].id)?.out === true, "the caught survivor is not marked out");

// The whistle closes the room, so nothing more from anyone is judged.
const afterMatch = await emit(walker, "match:position", destination);
assert(
  afterMatch.ok === false && afterMatch.reason === "out_of_match",
  `a fix after the match said ${JSON.stringify(afterMatch)}`,
);

// --- phase 9: the result is written down, and the board reads it back -------
// Recording is deliberately fire-and-forget, so the rows land a moment after
// the players were told the result.
const { leaderboard, playerStats, rankedPlayers } = await import("../src/lib/stats.ts");
const { rankTag } = await import("../src/lib/ranks.ts");

const history = async () =>
  (
    await prisma.matchPlayer.findMany({
      where: { user: { username: { in: names } } },
      select: {
        role: true,
        points: true,
        catches: true,
        caught: true,
        won: true,
        user: { select: { username: true } },
        match: { select: { winner: true } },
      },
    })
  ).map((row) => ({
    role: row.role,
    points: row.points,
    catches: row.catches,
    caught: row.caught,
    won: row.won,
    username: row.user.username,
    winner: row.match.winner,
  }));

let recorded = [];
for (let attempt = 0; attempt < 40 && recorded.length < 5; attempt += 1) {
  recorded = await history();
  if (recorded.length < 5) await wait(250);
}
assert(recorded.length === 5, `the finished match left ${recorded.length} player rows`);
assert(
  recorded.every((row) => row.winner === "survivors"),
  "the recorded winner is not the one the players were told",
);

const byName = new Map(recorded.map((row) => [row.username, row]));

const impostorRow = byName.get(names[impostorIndex]);
assert(
  impostorRow.role === "impostor" && impostorRow.points === IMPOSTOR_POINTS,
  `the impostor's row is ${JSON.stringify(impostorRow)}`,
);
assert(impostorRow.catches === 1, `the impostor's catches are ${impostorRow.catches}`);
assert(impostorRow.won === false, "the impostor was recorded as a winner");

const winnerRow = byName.get(names[walkerIndex]);
assert(
  winnerRow.role === "survivor" && winnerRow.points === SURVIVOR_POINTS,
  `the winning survivor's row is ${JSON.stringify(winnerRow)}`,
);
assert(winnerRow.catches === 1, "the winning tag was not recorded as a catch");
assert(winnerRow.won === true, "the winning survivor was not recorded as a winner");

const caughtRow = byName.get(names[players.indexOf(crowd[0])]);
assert(caughtRow.caught === true, "the caught survivor was not recorded as caught");
assert(caughtRow.won === true, "a caught survivor should still share their side's win");
assert(caughtRow.catches === 0, "a caught survivor was credited with a catch");

// The same queries the pages render, not a second copy of them.
const impostorUser = await prisma.user.findUniqueOrThrow({
  where: { username: names[impostorIndex] },
});
const stats = await playerStats(impostorUser.id);
assert(stats.matches === 1 && stats.wins === 0, `player stats say ${JSON.stringify(stats)}`);
assert(
  stats.points === IMPOSTOR_POINTS && stats.catches === 1,
  `player stats say ${JSON.stringify(stats)}`,
);

const board = await leaderboard();
assert(board.length > 0, "the leaderboard is empty after a match was played");
for (let index = 1; index < board.length; index += 1) {
  assert(
    board[index - 1].points >= board[index].points,
    "the leaderboard is not ordered by points",
  );
}

// And the page that shows it renders those rows.
const boardPage = await fetch(new URL("/leaderboard", base));
assert(boardPage.status === 200, `the leaderboard page answered ${boardPage.status}`);
const boardHtml = await boardPage.text();
assert(
  boardHtml.includes(board[0].username),
  "the leaderboard page does not show its own top row",
);
assert(boardHtml.includes(rankTag(board[0].points)), "the rank tag is not rendered");

// --- phase 13: the board knows where the reader stands ---------------------
// A position is one more than the players strictly ahead, so the rows level on
// points have to share a number rather than take their place in the list.
for (const row of board) {
  const ahead = board.filter((other) => other.points > row.points).length + 1;
  assert(
    row.rank === ahead,
    `${row.username} is ranked ${row.rank} with ${row.points} points and ${ahead - 1} ahead`,
  );
}

const ranked = await rankedPlayers();
const withMatches = (
  await prisma.matchPlayer.groupBy({ by: ["userId"] })
).length;
assert(
  ranked === withMatches,
  `the board is out of ${ranked} players, but ${withMatches} have played`,
);

// And the position the board prints is the one the account page computes, or the
// player is past the slice of the board - never a third answer.
const listed = board.find((row) => row.username === names[impostorIndex]);
assert(
  listed ? listed.rank === stats.rank : stats.rank > board.length,
  `the board and the account disagree about rank: ${listed?.rank} vs ${stats.rank}`,
);

const minePage = await fetch(new URL("/leaderboard", base), {
  headers: { cookie: cookies[impostorIndex] },
});
const mineHtml = await minePage.text();
assert(minePage.status === 200, `the board answered ${minePage.status} signed in`);
assert(
  mineHtml.includes(`you are #${stats.rank}`),
  `a signed-in player is not told where they stand: no "you are #${stats.rank}"`,
);
assert(
  mineHtml.includes(`${ranked} ${ranked === 1 ? "player" : "players"} ranked`),
  `the board does not say how big the field is: no "${ranked} players ranked"`,
);

// --- a started lobby takes nobody new -------------------------------------
const late = open(cookies[1]);
await connect(late, "late");
const lateJoin = await emit(late, "lobby:join", { code });
assert(
  lateJoin.ok === false && lateJoin.error === "started",
  `joining a started lobby said ${JSON.stringify(lateJoin)}`,
);
late.close();

// --- the host leaving hands the lobby to the next player ------------------
const hostA = open(cookies[2]);
const guestB = open(cookies[3]);
await Promise.all([connect(hostA, "handover host"), connect(guestB, "handover guest")]);
const second = await emit(hostA, "lobby:create");
await emit(guestB, "lobby:join", { code: second.lobby.code });

const handover = nextEvent(guestB, "lobby:state", "handover guest");
hostA.emit("lobby:leave"); // no ack
const afterLeave = await handover;

assert(
  afterLeave.players.length === 1,
  `expected 1 player after the host left, got ${afterLeave.players.length}`,
);
assert(afterLeave.players[0].isHost === true, "the remaining player should be host");
assert(
  afterLeave.hostId === afterLeave.players[0].id,
  "hostId should match the new host",
);

for (const socket of [...players, hostA, guestB, anonymous]) socket.close();
await prisma.user.deleteMany({ where: { username: { in: names } } });
// The users cascade their player rows away; the match rows they were part of
// are left behind with nobody in them, so sweep those too.
await prisma.match.deleteMany({ where: { players: { none: {} } } });

console.log(
  `ok — lobby codes and handover, secret roles, positions judged not trusted, movement capped, exposure, vision, missions, 45 seconds of invisibility, catches both ways, points and the end of a match all server-side, and the result written down where the leaderboard can read it and say where each player stands`,
);
process.exit(0);
