/**
 * Semantic enrichment for calendar events (ROADMAP 6.0-C): one batched Haiku call takes
 * every event needing classification and returns occasion + formality for each. Batched
 * rather than per-event on purpose — this is the cost lever, not the accuracy lever.
 * Callers are responsible for only passing events that haven't been classified yet
 * (`occasion IS NULL`); a given `google_event_id` should only ever go through this once.
 *
 * Deliberately fed only title/location/attendee_count — no event description. Any
 * "answer key" a user writes into an event's description for testing purposes must not
 * leak into the model's input.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface EventToClassify {
  google_event_id: string;
  title: string | null;
  location: string | null;
  attendee_count: number;
}

export interface EventClassification {
  google_event_id: string;
  occasion: string;
  formality: number;
}

const PROMPT_HEADER = `You are labeling a person's calendar events for an AI wardrobe stylist that will pick an outfit for each one. For every event below, infer:

- "occasion": a short snake_case label for what kind of event this is. Not a fixed enum — pick whatever fits, e.g. board_meeting, client_dinner, casual, gym, travel, formal, date_night, wedding, networking_event, brunch, doctor_appointment, flight, concert, workout.
- "formality": an integer 1-5, where 1 = very casual (gym, errands, lounging around) and 5 = black tie / most formal.

Base your judgment only on the title, location, and attendee_count given below — you have no other information about these events.

Events:
`;

export async function classifyEvents(events: EventToClassify[]): Promise<EventClassification[]> {
  if (events.length === 0) return [];

  const payload = events.map((e) => ({
    id: e.google_event_id,
    title: e.title ?? "(untitled)",
    location: e.location ?? null,
    attendee_count: e.attendee_count,
  }));

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${PROMPT_HEADER}${JSON.stringify(payload, null, 2)}

Return ONLY a JSON array, one object per input event, each shaped exactly like:
{"id": "<the input id>", "occasion": "...", "formality": <1-5>}
No markdown fences, no explanation.`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  const cleaned = text.replace(/```json\n?|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { id: string; occasion?: unknown; formality?: unknown } => typeof p?.id === "string")
      .map((p) => ({
        google_event_id: p.id,
        occasion: typeof p.occasion === "string" ? p.occasion : "unknown",
        formality:
          typeof p.formality === "number" && Number.isInteger(p.formality)
            ? Math.min(5, Math.max(1, p.formality))
            : 3,
      }));
  } catch (err) {
    console.error("classifyEvents: failed to parse Claude response:", err, text);
    return [];
  }
}
