// Phase 3 check: accounts end to end against a running server.
// Run with the dev server up and a migrated database:
//   node --env-file=.env scripts/check-auth.mjs
import pg from "pg";

const base = process.env.URL ?? "http://localhost:3000";
const username = "checkbot";
const password = "correct-horse-battery";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — run with --env-file=.env");
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Start clean so the script can be run over and over.
await db.query('DELETE FROM "User" WHERE username = $1', [username]);

const post = (path, fields, cookie) =>
  fetch(new URL(path, base), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });

const get = (path, cookie) =>
  fetch(new URL(path, base), {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });

const location = (response) => response.headers.get("location") ?? "";
const redirectedTo = (response, path) => location(response).startsWith(path);

const sessionCookie = (response) => {
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("ih_session="));
  return header ? header.split(";")[0] : null;
};

// 1. Register, and the new session survives an unrelated later request.
const registered = await post("/api/auth/register", { username, password });
assert(registered.status === 303, `register returned ${registered.status}`);
assert(
  redirectedTo(registered, `${base}/account`),
  `register redirected to ${location(registered)}`,
);
const cookie = sessionCookie(registered);
assert(cookie, "register did not set a session cookie");

const account = await get("/account", cookie);
const accountBody = await account.text();
assert(account.status === 200, `account returned ${account.status}`);
assert(
  accountBody.includes(`>${username}<`),
  "the account page does not show the signed-in username",
);
// Phase 12: the ladder renders for an account that has played nothing — it still
// holds a tag, and the next rung is priced.
assert(
  accountBody.includes("20 more points for Rookie"),
  "the account page does not show the climb to the next tag",
);
assert(
  accountBody.includes(">Legend<"),
  "the account page does not show the ladder",
);

// 2. The row itself: the password must not be recoverable.
const { rows } = await db.query(
  'SELECT "passwordHash" FROM "User" WHERE username = $1',
  [username],
);
assert(rows.length === 1, "no user row was written");
assert(rows[0].passwordHash !== password, "the password was stored in plain text");
assert(
  rows[0].passwordHash.startsWith("scrypt$"),
  `unexpected hash format: ${rows[0].passwordHash.slice(0, 12)}`,
);

// 3. Rejected input reports a reason instead of creating an account.
const taken = await post("/api/auth/register", { username, password: "different-password" });
assert(location(taken).includes("error=taken"), `duplicate username said ${location(taken)}`);
assert(!sessionCookie(taken), "a duplicate username still granted a session");

const weak = await post("/api/auth/register", { username: "checkbot2", password: "short" });
assert(location(weak).includes("error=password"), `short password said ${location(weak)}`);

const badName = await post("/api/auth/register", { username: "no spaces", password });
assert(location(badName).includes("error=username"), `bad username said ${location(badName)}`);

const wrong = await post("/api/auth/login", { username, password: "not-the-password" });
assert(location(wrong).includes("error=invalid"), `wrong password said ${location(wrong)}`);
assert(!sessionCookie(wrong), "a wrong password still granted a session");

// 4. Signing in issues a session of its own.
const loggedIn = await post("/api/auth/login", { username, password });
assert(loggedIn.status === 303, `login returned ${loggedIn.status}`);
assert(redirectedTo(loggedIn, `${base}/account`), `login redirected to ${location(loggedIn)}`);
const freshCookie = sessionCookie(loggedIn);
assert(freshCookie, "login did not set a session cookie");
assert(freshCookie !== cookie, "login reused the previous session token");

// 5. Signing out kills the session server-side, not just the cookie.
const loggedOut = await post("/api/auth/logout", {}, freshCookie);
assert(loggedOut.status === 303, `logout returned ${loggedOut.status}`);
const cleared = loggedOut.headers
  .getSetCookie()
  .find((cookie) => cookie.startsWith("ih_session="));
assert(cleared?.split(";")[0] === "ih_session=", `logout left cookie: ${cleared}`);

const afterLogout = await get("/account", freshCookie);
const afterBody = await afterLogout.text();
assert(!afterBody.includes(`>${username}<`), "the session still works after signing out");
assert(afterBody.includes("Not signed in"), "signed-out account page should offer a sign-in");

await db.query('DELETE FROM "User" WHERE username = $1', [username]);
await db.end();

console.log("ok — register, hashed storage, session persistence, errors, logout");
process.exit(0);
