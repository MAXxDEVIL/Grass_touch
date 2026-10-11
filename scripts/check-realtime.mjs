// Phase 2 check: one port serves Next.js and Socket.IO, and the realtime server
// is actually enforcing identity rather than trusting the client.
// Run with the dev server up: node scripts/check-realtime.mjs
import { io } from "socket.io-client";

const url = process.env.URL ?? "http://localhost:3000";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const page = await fetch(url);
assert(page.ok, `page returned ${page.status}`);

const socket = io(url, { transports: ["websocket", "polling"] });

const reply = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("connect timed out")), 10_000);
  socket.on("connect_error", reject);
  socket.on("connect", () => {
    // No session cookie, so the lobby must turn this player away.
    socket.emit("lobby:create", (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
});

socket.close();

assert(reply.ok === false, `anonymous create was allowed: ${JSON.stringify(reply)}`);
assert(reply.error === "signed_out", `expected signed_out, got ${reply.error}`);

console.log(`ok — page ${page.status}, realtime up, anonymous play refused`);
process.exit(0);
