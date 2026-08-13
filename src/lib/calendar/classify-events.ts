/**
 * Semantic enrichment for calendar events (ROADMAP 6.0-C): one batched Haiku call takes
 * every event needing classification and returns occasion + formality + companion for
 * each. Batched rather than per-event on purpose — this is the cost lever, not the
 * accuracy lever. Callers are responsible for only passing events that haven't been
 * classified yet; a given `google_event_id` should only ever go through this once.
 *
 * Deliberately fed only title/location/attendee_count — no event description. Any
 * "answer key" a user writes into an event's description for testing purposes must not
 * leak into the model's input.
 *
 * `companion` (ROADMAP D17) exists so the human stylist can be shown *who the client is
 * with* — "dinner with friends", "a formal meeting with colleagues" — without the phrase
 * ever being derived from the event title. It is a closed enum assembled into wording by
 * src/lib/stylist/occasion-projection.ts. Asking the model to "anonymize the title"
 * instead would sometimes leave a name in; a fixed enum structurally cannot.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface EventToClassify {
  google_event_id: string;
  title: string | null;
  location: string | null;
  attendee_count: number;
}

/**
 * Who the person is with. A closed set on purpose — unlike `occasion`, this value is
 * shown to a human stylist as generalized wording, so anything outside the list would be
 * free text that could carry a name straight through. Unrecognized answers fall back to
 * "unknown", which reads as "meeting someone".
 */
export const COMPANION_TYPES = [
  "colleague",
  "client",
  "friend",
  "family",
  "partner",
  "professional",
  "solo",
  "unknown",
] as const;

export type CompanionType = (typeof COMPANION_TYPES)[number];

export interface EventClassification {
  google_event_id: string;
  occasion: string;
  formality: number;
  companion: CompanionType;
  city: string | null;
}

/**
 * Deterministic extraction for titles that explicitly encode a travel destination.
 * These forms are common for multi-day all-day events and are not an inference:
 * `Vacation: Hamptons`, `Business Trip (London)`, `Work trip to Chicago`.
 */
export function explicitTravelDestinationFromTitle(title: string | null): string | null {
  if (!title || !/\b(?:vacation|holiday|trip|travel)\b/i.test(title)) return null;

  const parenthetical = title.match(/\(([^()]{2,80})\)\s*$/)?.[1]?.trim();
  const afterColon = title.match(/:\s*([^:]{2,80})\s*$/)?.[1]?.trim();
  const afterTo = title.match(/\b(?:trip|travel)\s+to\s+(.{2,80})\s*$/i)?.[1]?.trim();
  const candidate = parenthetical || afterColon || afterTo;
  if (!candidate || !/[A-Za-z]/.test(candidate)) return null;
  if (/\b(?:zoom|meet|teams|online|remote|virtual)\b/i.test(candidate)) return null;
  return candidate.replace(/^[\s-]+|[\s-]+$/g, "") || null;
}

const PROMPT_HEADER = `You are labeling a person's calendar events for an AI wardrobe stylist that will pick an outfit for each one. For every event below, infer:

- "occasion": a short snake_case label for what kind of event this is. Not a fixed enum — pick whatever fits, e.g. board_meeting, client_dinner, casual, gym, travel, formal, date_night, wedding, networking_event, brunch, doctor_appointment, flight, concert, workout.
- "formality": an integer 1-5, where 1 = very casual (gym, errands, lounging around) and 5 = black tie / most formal. An event that IS the journey — a flight, a train, an airport transfer, a long drive — is dressed for comfort and gets 1 or 2 no matter how formal the trip's purpose is. A multi-day all-day entry such as "Business Trip (London)" is a container for whole days rather than the journey itself, so judge that one by its purpose. Sport is the same: a workout, a match, a round of golf or a tennis game is worn in activewear and gets 1 or 2 even at a private club or with a client, because the clothes are sportswear whatever the company is.
- "companion": who the person is most likely with, from EXACTLY this list: ${COMPANION_TYPES.join(", ")}. Use "professional" for someone providing a service (doctor, lawyer, accountant, hairdresser, trainer), "solo" when they are clearly alone (gym, errands, focus block), and "unknown" when you genuinely cannot tell. Never invent a name or a company — only the label.

Base your judgment only on the title, location, and attendee_count given below — you have no other information about these events.

- "city": the city or named region explicitly identified by the location, normalized to a geocodable English place name. Extract it from a full street address when possible. For a clearly travel-related title that itself names the destination (for example "Vacation: Hamptons", "Business Trip (London)", or "Work trip to Chicago"), use that explicit destination even when location is blank. Return null for online meetings, blank locations, venue names without a clear place, or ambiguous non-travel titles. Never guess a destination from general world knowledge.

Events:
`;

export async function classifyEvents(events: EventToClassify[]): Promise<EventClassification[]> {
  if (events.length === 0) return [];

  const eventById = new Map(events.map((event) => [event.google_event_id, event]));

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
{"id": "<the input id>", "occasion": "...", "formality": <1-5>, "companion": "...", "city": "City name or null"}
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
      .filter(
        (p): p is { id: string; occasion?: unknown; formality?: unknown; companion?: unknown; city?: unknown } =>
          typeof p?.id === "string"
      )
      .map((p) => ({
        google_event_id: p.id,
        occasion: typeof p.occasion === "string" ? p.occasion : "unknown",
        formality:
          typeof p.formality === "number" && Number.isInteger(p.formality)
            ? Math.min(5, Math.max(1, p.formality))
            : 3,
        // Anything off the list becomes "unknown" rather than being stored as-is:
        // an unvetted string here would be rendered to the stylist verbatim.
        companion: COMPANION_TYPES.includes(p.companion as CompanionType)
          ? (p.companion as CompanionType)
          : "unknown",
        city: (() => {
          const explicit = explicitTravelDestinationFromTitle(eventById.get(p.id)?.title ?? null);
          if (explicit) return explicit;
          return typeof p.city === "string" && p.city.trim() && p.city.trim().length <= 120
            ? p.city.trim()
            : null;
        })(),
      }));
  } catch (err) {
    console.error("classifyEvents: failed to parse Claude response:", err, text);
    return [];
  }
}
