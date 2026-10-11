// Phase 16 check: the installable shell. The manifest, the icon and the service
// worker must all be served, and the manifest must really describe an app the
// browser can offer to install. The registration itself only runs in a browser,
// so it is pinned by the file: a worker with install and fetch listeners. Needs
// no server state of its own:   node scripts/check-pwa.mjs
const base = process.env.URL ?? "http://localhost:3000";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// 1. The manifest is what makes the browser offer to install the game.
const manifest = await (
  await fetch(new URL("/manifest.webmanifest", base))
).json();
assert(
  typeof manifest.name === "string" && manifest.name.length > 0,
  "the manifest has no name",
);
assert(manifest.display === "standalone", `display is "${manifest.display}"`);
assert(manifest.start_url === "/", `start_url is "${manifest.start_url}"`);
assert(
  manifest.background_color && manifest.theme_color,
  "the manifest has no palette",
);
assert(
  Array.isArray(manifest.icons) && manifest.icons.length > 0,
  "the manifest has no icons",
);
const icon = manifest.icons[0];
assert(
  icon.sizes === "512x512" && icon.type === "image/png",
  `the icon is not a 512 png: ${JSON.stringify(icon)}`,
);

// 2. The pages link the manifest, so a browser finds it without asking.
const home = await (await fetch(new URL("/", base))).text();
assert(home.includes('rel="manifest"'), "the pages do not link the manifest");

// 3. The service worker would actually install and serve from a cache.
const sw = await (await fetch(new URL("/sw.js", base))).text();
assert(
  sw.includes('addEventListener("install"'),
  "the service worker has no install listener",
);
assert(
  sw.includes('addEventListener("fetch"'),
  "the service worker has no fetch listener",
);
assert(
  sw.includes("skipWaiting") && sw.includes("caches"),
  "the service worker cannot take over a cache",
);

// 4. The icon route is a real image, for the tab and the home screen.
const iconResponse = await fetch(new URL("/icon", base));
assert(iconResponse.ok, `the icon route returned ${iconResponse.status}`);
assert(
  (iconResponse.headers.get("content-type") ?? "").startsWith("image/"),
  "the icon route is not an image",
);

console.log(
  "ok — a manifest worth installing, a 512 png icon, a worker with install and fetch, and pages that link it all",
);
process.exit(0);