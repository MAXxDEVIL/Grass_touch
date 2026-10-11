// Phase 12 check: the ladder. Every boundary is asserted, because an off-by-one
// in a threshold is invisible until a player is one point short of a tag.
// Needs no server: node scripts/check-ranks.mjs
import { RANKS, rankProgress, rankTag } from "../src/lib/ranks.ts";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// An account with nothing played still has a tag and a next rung to climb, so
// the bottom of the ladder has to be at zero.
assert(RANKS[0].at === 0, `the ladder starts at ${RANKS[0].at}, not 0`);
assert(rankTag(0) === RANKS[0].tag, `a new account is ${rankTag(0)}`);

for (let i = 1; i < RANKS.length; i++) {
  assert(
    RANKS[i].at > RANKS[i - 1].at,
    `${RANKS[i].tag} is not above ${RANKS[i - 1].tag}`,
  );
}

// One point below each threshold keeps the lower tag; the threshold itself
// moves up. Points are whole numbers, so 19 and 20 are the whole question.
for (const [points, tag] of [
  [0, "Newcomer"],
  [19, "Newcomer"],
  [20, "Rookie"],
  [74, "Rookie"],
  [75, "Regular"],
  [199, "Regular"],
  [200, "Hunter"],
  [499, "Hunter"],
  [500, "Legend"],
  [10_000, "Legend"],
]) {
  assert(rankTag(points) === tag, `${points} points is ${rankTag(points)}, not ${tag}`);
}

// A point short of a tag, the bar is not full: it fills to 100 only once the
// tag is reached.
const almost = rankProgress(19);
assert(almost.tag === "Newcomer", `19 points is ${almost.tag}`);
assert(almost.next?.tag === "Rookie", `19 points is not climbing to ${almost.next?.tag}`);
assert(almost.percent === 95, `19 of 20 points reads as ${almost.percent}%`);
assert(
  rankProgress(499).percent === 99,
  `499 of 500 points reads as ${rankProgress(499).percent}%`,
);

// The floor of a band is where its bar starts, whatever the band above costs.
const fresh = rankProgress(20);
assert(fresh.tag === "Rookie", `20 points is ${fresh.tag}`);
assert(fresh.next?.tag === "Regular", `20 points is not climbing to ${fresh.next?.tag}`);
assert(fresh.percent === 0, `the first point of a band reads as ${fresh.percent}%`);

// Nothing above the top rung to climb, and no division by a missing rung.
const top = rankProgress(500);
assert(top.next === null, `${top.tag} still has a next tag: ${top.next?.tag}`);
assert(top.percent === 100, `the top of the ladder reads as ${top.percent}%`);

console.log(
  `ok — ${RANKS.length} rungs, every threshold and the progress between them`,
);
process.exit(0);
