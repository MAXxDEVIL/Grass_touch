// The service worker that makes Impostor Hunt installable and keeps the shell
// standing up when a phone is offline. The game itself needs the server, so
// nothing live is ever trusted from here: same-origin GETs go to the network
// first, and only a cache they have already saved stands in when the network is
// gone. Rename CACHE to retire old entries on a release.
const CACHE = "impostor-hunt-v1";

self.addEventListener("install", (event) => {
  // Being installable matters more than a warm cache: a failed precache must
  // not abort the install.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The socket and the API are live, not assets.
  if (
    url.pathname.startsWith("/socket.io/") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches
          .open(CACHE)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match(request)),
  );
});