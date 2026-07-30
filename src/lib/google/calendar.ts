/**
 * Thin wrapper around the Google Calendar v3 events.list endpoint. Knows nothing about
 * our own DB or auth — callers pass an already-valid access token (see
 * src/lib/google/client.ts's getAccessToken()) and get back Google's raw event shape.
 */
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  attendees?: { email?: string; self?: boolean }[];
}

export async function listCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google Calendar events.list failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.items ?? [];
}
