// Phase 14 check: the wording seam. The game must play identically without a
// key, and a model's reply must be clamped before it can reach a screen.
// Needs no server and no key: node scripts/check-ai.mjs
import { generateMission } from "../src/lib/missions.ts";
import { missionPrompt, missionWording, tidyMission } from "../src/lib/ai.ts";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

// The seam must not need a key: this check runs without one, so the
// no-network fallback is the thing being asserted.
assert(
  process.env.GROQ_API_KEY === undefined,
  "this check must run without a Groq key",
);

const mission = generateMission({ lat: 51.5, lng: -0.12 });
assert(mission.text.length > 0, "a mission was generated without words");

// No key, no network, nothing changes.
const fallback = await missionWording(mission);
assert(
  fallback === mission.text,
  "wording changed without a key; is ai.ts reaching for the network?",
);

// The model is told the spec it must respect, never left to invent one.
const prompt = missionPrompt(mission);
assert(prompt.includes(String(mission.target)), "the prompt hides the distance");
assert(prompt.includes(mission.kind), "the prompt hides the kind of mission");

// Anything the model says is clamped, and junk means "keep the template".
assert(
  tidyMission("Weave 85 metres through the back streets.") ===
    "Weave 85 metres through the back streets.",
  "a clean line was mangled",
);
assert(
  tidyMission("  Walk  85 m.\n") === "Walk 85 m.",
  "a wrapped line was not collapsed",
);
assert(tidyMission("") === null, "the empty reply was trusted");
assert(tidyMission("   ") === null, "a blank reply was trusted");
assert(tidyMission(42) === null, "a non-string reply was trusted");
assert(tidyMission("x".repeat(181)) === null, "an overlong reply was trusted");
assert(
  tidyMission("walk\0away") === null,
  "a reply with control characters was trusted",
);

console.log(
  "ok — no key means no network, the prompt carries the spec, and model output is clamped",
);
process.exit(0);