// Phase 10 check: the app the way a host runs it — the production build served
// by the real server, not the dev server.
//   pnpm check:prod
// Stop `pnpm dev` first: both use `.next`.
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const port = process.env.PROD_PORT ?? "3101";
const base = `http://localhost:${port}`;
const username = "prodcheckbot";
const password = "correct-horse-battery";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — run with --env-file=.env");
}

const { prisma } = await import("../src/lib/db.ts");
await prisma.user.deleteMany({ where: { username } });

// NODE_ENV=production is how a host runs it: next() serves the build that is
// already in .next instead of compiling on the fly.
const server = spawn(process.execPath, ["server.ts"], {
  env: { ...process.env, NODE_ENV: "production", PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));

const stop = async () => {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    sleep(3_000),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
};

try {
  // 1. It boots and serves the pages the game is made of.
  let home;
  for (let attempt = 0; attempt < 40 && !home?.ok; attempt += 1) {
    assert(server.exitCode === null, `the production server exited:\n${log}`);
    try {
      home = await fetch(base);
    } catch {
      // still booting
    }
    if (!home?.ok) await sleep(500);
  }
  assert(home?.ok, `the production server never answered:\n${log}`);

  for (const path of ["/leaderboard", "/login", "/register", "/play", "/account"]) {
    const page = await fetch(new URL(path, base));
    assert(page.status === 200, `${path} answered ${page.status} in production`);
  }

  // 2. Its database wiring: a real account, registered against the built app.
  const registered = await fetch(new URL("/api/auth/register", base), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  assert(
    registered.status === 303,
    `register returned ${registered.status} in production`,
  );

  // The cookie is Secure in production, so a browser on plain http would drop
  // it; the check is not a browser and passes the header itself.
  const cookie = registered.headers
    .getSetCookie()
    .find((header) => header.startsWith("ih_session="))
    ?.split(";")[0];
  assert(cookie, "register did not set a session cookie in production");

  const account = await fetch(new URL("/account", base), { headers: { cookie } });
  const accountBody = await account.text();
  assert(account.status === 200, `account returned ${account.status} in production`);
  assert(
    accountBody.includes(`>${username}<`),
    "the production account page lost the session",
  );

  // 3. And its realtime wiring: next and socket.io on the one port.
  const socket = io(base, { transports: ["websocket", "polling"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timed out")), 10_000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  socket.close();
} catch (error) {
  await stop();
  console.error(log.trim());
  await prisma.user.deleteMany({ where: { username } });
  throw error;
}

await stop();
await prisma.user.deleteMany({ where: { username } });

console.log(
  `ok — production build serves its pages, writes an account and answers on the socket`,
);
process.exit(0);
