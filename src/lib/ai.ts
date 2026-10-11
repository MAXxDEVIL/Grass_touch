// The words on a mission. The rules decide what must be done and how far; the
// model only gets to dress that up in prose, so nothing it says can make a
// mission unmeasurable or unplayable. Without a Groq key, or when the model is
// slow or says nothing useful, the template wording the mission was born with is
// what the player sees — the game never waits on this file.
import type { Mission } from "./realtime.ts";

/** The request the model sees: the one mission it is allowed to rewrite. */
export function missionPrompt(mission: Mission): string {
  return [
    "You write mission objectives for a real-world hide-and-seek game played",
    "outside on phones. A survivor on a " + mission.kind + " mission has been",
    "given this task:",
    "",
    `"${mission.text}"`,
    "",
    "Rewrite it as ONE short, playful, natural sentence a walking player sees",
    `on their phone. Keep the distance figure (${mission.target} m) exactly as`,
    "it is. No quotes, no bullet points, no line breaks, under 140 characters.",
  ].join("\n");
}

/**
 * A reply worth putting on a screen, or null when it is not. Model output is the
 * only thing in the game that is not ours, so it is clamped rather than trusted:
 * junk, silence and an essay all mean "keep the template".
 */
export function tidyMission(word: unknown): string | null {
  if (typeof word !== "string") return null;
  // A model wraps its lines; a mission is one line on a phone.
  const text = word.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > 180) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

/**
 * Wording for a mission, or its template text when there is no key, the model
 * takes too long, or its reply does not pass muster. Never rejects, so callers
 * can treat it as fire-and-forget.
 */
export async function missionWording(
  mission: Mission,
  timeoutMs = 1500,
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return mission.text;

  try {
    const reply = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0.9,
        max_tokens: 60,
        messages: [{ role: "user", content: missionPrompt(mission) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!reply.ok) return mission.text;
    const payload: { choices?: { message?: { content?: unknown } }[] } =
      await reply.json();
    return tidyMission(payload.choices?.[0]?.message?.content) ?? mission.text;
  } catch {
    return mission.text;
  }
}