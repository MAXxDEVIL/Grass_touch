// Phase 11 check: the match reads itself — the countdown a player watches, the
// catch count the result screen works out on its own, and the landing page
// actually teaching the rules.
// Run with the dev server up: node scripts/check-polish.mjs
import { catchesOf, clock } from "../src/lib/feedback.ts";

const url = process.env.URL ?? "http://localhost:3000";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// The countdown rounds up, so the last second of a match still reads 0:01
// rather than sitting at 0:00, and a clock that has already run out never
// renders as a negative while the whistle is on its way.
const reads = [
  [15 * 60 * 1000, "15:00"],
  [600_000, "10:00"],
  [60_000, "1:00"],
  [61_000, "1:01"],
  [59_999, "1:00"],
  [1_001, "0:02"],
  [999, "0:01"],
  [0, "0:00"],
  [-5_000, "0:00"],
];

for (const [ms, expected] of reads) {
  assert(clock(ms) === expected, `${ms} ms reads as ${clock(ms)}, not ${expected}`);
}

// Points only ever come from a catch, at one rate per role, which is what lets
// the result screen say what each player did without the server sending it.
assert(catchesOf("impostor", 0) === 0, "an impostor with no points has catches");
assert(catchesOf("impostor", 10) === 1, "10 points is not one impostor catch");
assert(catchesOf("impostor", 30) === 3, "30 points is not three impostor catches");
assert(catchesOf("survivor", 2) === 1, "2 points is not one survivor tag");
assert(catchesOf("survivor", 0) === 0, "a survivor with no points has catches");
assert(catchesOf("survivor", 6) === 3, "6 points is not three survivor tags");

// The rules have to be on the page, and the page has to be in the first paint.
const page = await fetch(url);
assert(page.ok, `the landing page returned ${page.status}`);
const html = await page.text();

for (const line of [
  "one impostor",
  "finish missions to vanish for 45 seconds",
  "inside a 40 × 40 m box",
  "15-minute hunt",
]) {
  assert(html.includes(line), `the landing page does not explain the rules: no "${line}"`);
}

console.log(`ok — countdown, catch counts, and ${reads.length} clock readings; rules on the page`);
process.exit(0);
