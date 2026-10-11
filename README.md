# Impostor Hunt

Real-time, location-based social deduction for five phones. One player is the
impostor, four are survivors. Survivors complete missions and stay moving; the
impostor hunts them with a 40×40m vision cone. Survivors win by being the last
ones standing, by tagging the impostor while invisible, or when the impostor
quits; the impostor wins by catching everyone, or on points at the whistle.

Built in phases — see "Status" below for how far along it is.

## Stack

Deliberately small: one Next.js app, one Postgres database, no Redis, no
PostGIS, no auth framework. Mission wording can be handed to a free, open-weight
model, but the game never requires it (phase 14).

| Piece | Choice |
| --- | --- |
| App + realtime | Next.js 16 + Socket.IO on **one port** (`server.ts`) |
| Data | Postgres + Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Accounts | Hand-rolled sessions in Postgres; `scrypt` from `node:crypto` |
| UI | Tailwind v4 with the palette in `src/app/globals.css` |
| Map | Leaflet with OpenStreetMap raster tiles |
| Missions | Specs (and wording) from `generateMission()`; the words fly out to Groq's free tier when `GROQ_API_KEY` is set (phases 7, 14) |

Next and Socket.IO share a port on purpose: it makes the whole game deployable
as a **single free service**. Note `output: "standalone"` is *not* compatible
with a custom server, so deploys run `next build` + `node server.ts`.

## Setup

Needs Node 22+ and pnpm. No Postgres install is required — Prisma ships one.

```bash
pnpm install
cp .env.example .env

# Local Postgres, no sudo. Prints a postgres:// URL — paste it into .env.
pnpm exec prisma dev -d

pnpm exec prisma migrate dev
```

`prisma dev` only needs starting once per boot; `pnpm exec prisma dev ls` prints
the current URL if `.env` ever stops connecting.

### Using a system PostgreSQL instead

```bash
sudo pacman -S --needed postgresql
sudo -u postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb impostor_hunt
```

Then set `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/impostor_hunt?schema=public"`
(drop the `?sslmode=disable`) and re-run `pnpm exec prisma migrate dev`.

## Running

```bash
pnpm dev                      # http://localhost:3000
pnpm check                    # asserts the realtime, account, lobby, position, catch, result and screen contracts
pnpm check:prod               # builds, then runs that build the way a host does
pnpm build && pnpm start      # production, same single port
```

`pnpm dev` runs `server.ts` rather than `next dev`, so the `server.ts` file
itself does not hot-reload — restart it when you change it. Page code and
components still hot-reload normally.

`pnpm check` needs the server up and a migrated database. It talks real HTTP and
reads the recorded rows back through the app's own database client, so it fails
loudly if a phase regresses.

`pnpm check:prod` is the deploy gate: it builds, then boots that build with
`NODE_ENV=production` and checks the pages, registration and the socket. Stop
`pnpm dev` first — both use `.next`.

### Testing on a real phone

Browsers refuse to hand a page the device's location over plain `http`, except
on `localhost` itself. To play on phones, put the dev server behind a free https
tunnel (install `cloudflared` first):

```bash
cloudflared tunnel --url http://localhost:3000
```

Open the `https://…trycloudflare.com` URL it prints on each phone. Nothing else
changes — the same single port serves the page and the socket.

## Deploy (free, no card)

Two free services, neither of which asks for payment details: **Render** runs the
app, **Neon** holds the database. Render's own free Postgres is deleted 30 days
after it is created, which is why the database lives on Neon.

1. **Database.** Create a Neon project on the free plan and copy its connection
   string. Use the **direct** one — the host without `-pooler` — because the
   start command runs migrations, and schema changes through a pooler are not
   reliable. The string carries `?sslmode=require`, which the driver adapter
   reads on its own.

2. **App.** On Render, *New → Blueprint* and pick this repository. It reads
   `render.yaml`, which carries the build and start commands, and it prompts for
   `DATABASE_URL` — paste the string from step 1 and deploy.

3. Open the `https://…onrender.com` URL it gives you. HTTPS comes with it, and
   the game needs it: browsers only hand out location over a secure origin.

The blueprint builds with `prisma generate && next build` (the generated Prisma
client is deliberately not committed), then at boot runs
`prisma migrate deploy` to bring the schema up to date before starting the
combined Next + Socket.IO server on the port Render assigns. Both commands are
also all it takes on any other Node host:

```bash
pnpm install --prod=false && pnpm build
pnpm exec prisma migrate deploy && pnpm start
```

Two free-plan facts worth knowing:

- The service sleeps after 15 minutes without traffic, so the next visitor waits
  about a minute for it to wake. The first player to open the link pays that.
- 750 instance-hours a month is more than one always-on service needs (a month
  is ~730 h). The real reason to run **exactly one instance** is state: lobbies
  and running matches live in memory and are not shared between instances.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `SHADOW_DATABASE_URL` | A second, empty database `prisma migrate dev` clones for shadow migrations |
| `PORT` | Port for the combined Next + Socket.IO server (default 3000) |
| `GROQ_API_KEY` | *Optional.* Mission wording via Groq's free tier (open-weight models, no card). Unset, missions use their template wording |

Secrets live only in `.env` (gitignored). `.env.example` holds placeholders.
`SHADOW_DATABASE_URL` is only needed locally: `prisma dev` ships an empty shadow
database on port 51215, and without it every migration fails, because the local
dev database *is* `template1` and Postgres clones that same template for the
shadow — so the clone already contains the tables the migration is about to add.
A system PostgreSQL does not need this: `createdb` a second empty database and
point `SHADOW_DATABASE_URL` at it.

## Status

All 16 phases are done and checked.

| Phase | Delivered |
| --- | --- |
| 1 | Skeleton, design tokens, Postgres + Prisma, first migration |
| 2 | One-port Next + Socket.IO spine, typed contract |
| 3 | Accounts: register, sign in, sign out, sessions, profile page |
| 4 | Lobbies: 4-character codes, five seats, host start, secret role reveal |
| 5 | Live map: device GPS on OpenStreetMap, accuracy shown, fixes judged server-side |
| 6 | Movement rules: speed cap, 5-minute exposure, 10 m heartbeat, 40 × 40 m vision |
| 7 | Missions for survivors, and 45 seconds of invisibility for finishing one |
| 8 | Catches both ways, points, a 30-second scatter window, a 15-minute whistle and a revealed winner |
| 9 | The result written down: a persistent leaderboard, rank tags and per-player history |
| 10 | Deployed: a production build, migrations at boot, and a free-host blueprint |
| 11 | The match reads itself: a countdown to the whistle, audible cues, catches in the result, and the rules on the landing page |
| 12 | Progression: one ladder of five tags, how far the next one is, and what a match was worth |
| 13 | Rankings: a position from the query itself, the size of the field, and the reader's own row even below the cut |
| 14 | Real AI missions: an open-weight model writes each mission's wording; the rules still decide what is asked and how far |
| 15 | Safety: one account gets only one seat in a match, and a phone gone quiet is dropped, not left as a ghost |
| 16 | A phone can install the game: a manifest, a home-screen icon, and a service worker holding the shell offline |

Accounts are hand-rolled and use no framework: sessions are rows in Postgres
holding a SHA-256 of a 32-byte token, the cookie is httpOnly and `sameSite=lax`,
and passwords are `scrypt` hashes with a per-user salt. Signing out deletes the
session row, not just the cookie. Login runs the hash even for a username that
does not exist, so timing cannot be used to discover accounts.

Lobbies live in memory (`server.ts`): five seats, join by a four-character code
that avoids `0/O/1/I`, and the host starts the match once all five are filled.
The server picks the impostor and tells **each socket only its own role** — the
roster everyone sees carries no roles at all. Whoever connects is the player, so
identity comes from the session cookie on the socket handshake and never from
anything the client claims. A lobby is never stranded: if the host leaves, the
seat passes to the longest-waiting player.

The map is entirely client-side. The device's own `watchPosition` feed is drawn
as a dot with an accuracy circle, and the impostor also sees the 40 × 40 m box
the rules give them. Every fix is *also* sent to the server, which refuses
anything that is not a real coordinate pair in range or is vaguer than 30 m,
rather than trusting the phone. Consumer GPS is 5–20 m at best outdoors and
worse between buildings, so a fix beyond that says less about where a player is
than the rules themselves do.

Phase 6 adds the rules that decide what each player is allowed to know. The
server keeps the last accepted fix per socket and re-runs the whole room after
every one, because a single new position can change several answers at once. A
fix further from the last one than both accuracies plus 8 m/s allows is refused
as a jump — the elapsed time comes from the server's own arrival clock, so a
client that fires fixes in a burst buys no extra distance. Standing still for
five minutes exposes a player: the impostor sees them wherever they are, and
moving again hides them. The impostor is told which survivors fall inside their
40 × 40 m box and nothing else; a survivor is sent no positions at all, only a
pulse when anyone — friend or stranger — comes within 10 m. Those decisions live
in `src/lib/match-rules.ts` as pure functions, so the server and `pnpm check`
run the same code without waiting five minutes for the idle clock.

Phase 7 gives the survivors something to do. Each is handed one mission drawn
from three templates — walk a distance, get far from everyone, or get
uncomfortably close to someone — and finishing it makes them invisible to the
impostor for 45 seconds. The impostor gets no missions. Only the survivor sees
their own objective and how far along they are, progress is re-sent only when it
really moves, and the server alone decides when a mission is done. A mission
pays out only after its holder has walked at least 20 m from where it was issued,
which is what stops "get close to someone" from being completed for free at the
moment a match starts. Missions come from one function, `generateMission()`, so phase 14 could hand the
wording to a model without touching the measuring at all.

Phase 8 turns the information game into a match with a result. Two players
within 6 m are touching, and the server alone decides which of them is taken:
the impostor catching a survivor is worth 10 points and puts that survivor out
for good, while a survivor catching the impostor is worth 2 and ends the match
in their favour on the spot. Invisibility is what arbitrates a simultaneous tag —
a survivor who has just finished a mission can neither be seen nor caught, so
they are the one who gets to do the taking. Nobody can be caught for the first
30 seconds, because five people start a match standing on one spot, and a fix
older than 45 seconds is not trusted at all, so a phone that dies mid-match
cannot be tagged where it last was. A match ends when the impostor quits, when
everyone has been caught, when a survivor tags the impostor, or at the
15-minute whistle, where the impostor's points are weighed against the
survivors' combined total — a tie goes to the survivors. Only then is the
impostor named.

Phase 9 writes that result down, so a match outlives the browser tab that
played it. The server stores the match plus one row per seat — role, points,
catches, whether they were caught and whether they won — and deliberately does
so *after* the players have been told how it ended, and without letting a
database hiccup take the socket loop with it. Every point in the game comes from
a catch, so a seat's catch count is derived from its score at write time instead
of being tallied separately. `/leaderboard` ranks every account by points with a
rank tag — Newcomer, Rookie, Regular, Hunter, Legend — and `/account` shows a
player's own matches, wins, catches, points and recent results.

Phase 10 is the one that lets five other people play it. The build generates the
Prisma client before compiling, because that client is a build product and is not
in the repository; the boot command applies migrations and then starts the same
single-port server, so one free service is the whole deployment. `render.yaml`
is a Blueprint that encodes all of it and prompts for one secret, the Neon
connection string; the host supplies HTTPS, which is not a nicety here, since
browsers refuse to hand a page the device's location over plain http. This phase's
check builds the app, starts that build in production mode and asserts it serves
the pages, registers an account and answers on the socket — the deploy itself,
tested rather than assumed.

Phase 11 is the first phase about playing rather than about working. A match
lasted 15 minutes and nothing on the screen said so: the match screen now counts
down to the whistle and turns red in the last minute, and the 30-second scatter
window it opens with is a live countdown instead of a sentence that goes stale on
the first tick. The heart of the mechanic on a phone is the buzz, and iOS Safari
has never supported `navigator.vibrate`, so every cue a warning depends on is now
audible too — someone close, exposure, a mission paying out, being caught, the
end — synthesised per cue by an oscillator rather than shipped as sound files.
The browser only lets a page make noise from a gesture, so the audio context is
opened by the lobby button taps and nothing plays before them. The result screen
now says what each player did as well as what they scored, working the catch
counts back out of the scores at the two fixed rates instead of asking the server
to send a number it already stores. The countdown is a local timer started when
the match does, which is accurate to a socket round trip and, unlike a server
timestamp, survives a phone whose own clock is minutes out. This phase's check
pins the clock's rounding at its edges and the catch arithmetic, then fetches the
landing page and insists the four rules are actually on it.

Phase 12 is the ladder a score climbs. Five tags — Newcomer, Rookie, Regular,
Hunter, Legend — now come from one table in `src/lib/ranks.ts` instead of a chain
of `if`s inside the stats module, which is what lets the account page show a
progress bar toward the next tag, price it in points, and list all five rungs
with the one being held picked out. The same card appears on `/play` and at the
end of a match, so a player reads one description of their standing rather than
three. The end of a match is where the phase earns its keep: the result screen
now says what the match was worth to that player, next to the bar it just moved.
That total is not asked of the database at the worst moment — writes finish after
the players have been told how their match ended — but kept as a running sum in
the lobby, which adds each finished match to the baseline its page rendered with,
so a session that plays three matches in a row still counts all three. An account
that has played nothing still holds a tag and a priced next rung, which is why
the bottom of the ladder is zero rather than a number that only a regular would
ever reach. This phase's check walks every threshold at the point where it turns
over — 19 points is a Newcomer, 20 is a Rookie — and asserts the progress
arithmetic at the floor and the ceiling of a band, then, through the account
check, that the page renders the climb and the ladder without a match played.

Phase 13 makes the board answer the question a player actually has, which is not
"who is winning" but "where am I". Its position now comes out of the query that
produces the rows — one more than the number of players strictly ahead — instead
of from a row's place in the list, which is capped at twenty and would number two
players level on points differently depending on where the cut fell. The page says
how many players the board is out of, which is the number that makes a position
mean anything, and it always shows the reader: their own row is picked out when
they are in the top slice, and when they are below it their row is appended under
a break, built from the same record the account page reads, so the two cannot
disagree. A signed-out visitor sees the board and the size of the field, and is
told that signing in would show their place. This phase's check rides along in the
match check, which is the only harness that can hand a board a real match: it
recomputes every row's position from the definition and insists the SQL agrees,
counts the field both ways, asserts the board and the account page never give a
player two different ranks, and fetches the page signed in to see the reader's
own standing rendered.

Phase 14 is the "real AI" missions that were promised at the start, with the
safety that has kept every rule server-side. An open-weight model — Groq's free
tier serves Llama and Qwen with no card — writes *the words*, and only the words:
the kind of mission and the distance in metres are still decided by
`generateMission()` and the same pure progress rules, so no model output can
make a mission unmeasurable or unplayable, and every earlier phase's check still
passes without a key in the room. The survivor sees the mission the instant it
is issued, in its template wording, and the model's richer sentence swaps in a
beat later, fetched in the background so a fix never waits on the network; a
reply that is junk, silence, an essay, or slower than 1.5 seconds simply means
the template is kept. Anything a model does say is clamped before it can reach
a screen — collapsed to one line, cut at 180 characters, emptied if it is not
text — and the swap is guarded by the mission's id, so a late reply can never
overwrite the newer mission the player is already reading. Without `GROQ_API_KEY`
the game is byte-for-byte what it was in phase 13: the seam is genuinely
optional. This phase's check runs with no key on purpose, proves no network is
touched without one, and pins the prompt (which must carry the exact distance
and kind) and the clamp (which must kill every kind of junk).

Phase 15 is the safety that a five-person game on real streets actually needs,
and it closes the two gaps the earlier phases left open. The first is the
cheapest exploit in the game: five tabs in one browser are five sockets sharing
one session cookie, so one account could once sit in several seats of the same
match — an impostor who already knows the roster, or simply a team of four
survivors. A lobby now refuses a second seat for an account that is already in
it, and the refusal happens *after* the full-seat check, so the phase 4 rule
that a sixth real player is turned away still says what it said. The second gap
was a ghost: a player whose phone went quiet had their old fix skipped by every
rule for 45 seconds, but the dot could linger on the impostor's map because the
map only redraws when someone reports in — and a match where everyone is hiding
is exactly when nobody does. The five-second sweep that already drove the match
to its whistle now also drops a track that has gone stale, deletes the mission
that came with it, and re-runs the room's rules so the sights everyone may see
are refreshed. A phone that comes back simply starts again from its next fix,
fresh and visible, which is fairer than resuming from a position nobody trusts
any more. This phase's check holds both halves: a second socket on the same
account is refused while a different account still joins the same lobby, and the
drop predicate — the same `stale()` call the sweep is built on — is pinned at
its boundary.

Phase 16 is the end of the road: a phone can install the game, which is what a
game played on streets from a phone was missing. The manifest in the metadata
convention describes an app the browser can offer to install — its own name,
the night palette as its theme, `standalone` so it opens like an app rather
than a tab, and a home-screen icon that is generated once at build time from
the same sighting reticle the map implies, as a real 512×512 PNG rather than a
file that must be shipped and kept in sync. A small service worker, written by
hand instead of adding a PWA plugin to the stack, is registered only in the
production build: it holds the shell so the game can be reached when a phone
has no signal, serves every other same-origin GET off the network first so a
cached shell is never trusted over live assets, and leaves the socket and the
API alone, because a match is a live conversation, not a page. Installing
needs the HTTPS that the deployment already provides, and the offline promise
is honestly scoped: the shell and the rules survive a lost connection, but a
match that needs the server cannot be played without it. This phase's check
reads the manifest and demands the fields that make it installable, pins the
worker to real install and fetch listeners, and verifies the pages link the
manifest and the icon route serves a real image.

Everything that decides a match — who is exposed, who can see whom, who is
touching whom and who has won — runs on the server. The client is an input
device and a screen.
