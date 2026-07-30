import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  StylistBooking,
  StylistServiceType,
  StylistSlot,
  StylistSlotsResponse,
} from "@/types/stylist";

const ACTIVE_BOOKING_STATUSES = ["confirmed"];
const ONLINE_TIMES = ["10:00", "11:30", "14:00", "15:30"];
const ONLINE_WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const IN_PERSON_WEEKDAYS = new Set([2, 4, 6]);

interface GeneratedSlot extends StylistSlot {
  start: Date;
  end: Date;
}

function isServiceType(value: unknown): value is StylistServiceType {
  return value === "online_30" || value === "in_person_day";
}

function safeTimeZone(value: string | null | undefined) {
  const candidate = value || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

const STYLIST_SCHEDULE_TIME_ZONE = safeTimeZone(
  process.env.STYLIST_TIME_ZONE || "America/New_York"
);

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function timeZoneOffsetMinutes(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUTC = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );
  return (asUTC - instant.getTime()) / 60_000;
}

/** Convert a local wall-clock date/time in an IANA timezone to its UTC instant. */
function zonedDateTimeToUTC(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(
    wallClockAsUTC - timeZoneOffsetMinutes(new Date(wallClockAsUTC), timeZone) * 60_000
  );
  return new Date(wallClockAsUTC - timeZoneOffsetMinutes(first, timeZone) * 60_000);
}

function labels(start: Date, end: Date, timeZone: string, serviceType: StylistServiceType) {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    dateLabel,
    timeLabel:
      serviceType === "online_30"
        ? timeFormatter.format(start)
        : `${timeFormatter.format(start)}–${timeFormatter.format(end)}`,
  };
}

function generateSlots(
  serviceType: StylistServiceType,
  displayTimeZone: string,
  now = new Date()
) {
  const today = localDate(now, STYLIST_SCHEDULE_TIME_ZONE);
  const slots: GeneratedSlot[] = [];
  const maxDays = serviceType === "online_30" ? 28 : 56;
  const leadTime = serviceType === "online_30" ? 12 * 60 * 60_000 : 72 * 60 * 60_000;

  for (let offset = 1; offset <= maxDays; offset += 1) {
    const date = addDays(today, offset);
    const day = weekday(date);

    if (serviceType === "online_30" && ONLINE_WEEKDAYS.has(day)) {
      for (const time of ONLINE_TIMES) {
        const start = zonedDateTimeToUTC(date, time, STYLIST_SCHEDULE_TIME_ZONE);
        if (start.getTime() <= now.getTime() + leadTime) continue;
        const end = new Date(start.getTime() + 30 * 60_000);
        slots.push({
          start,
          end,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          ...labels(start, end, displayTimeZone, serviceType),
        });
      }
    }

    if (serviceType === "in_person_day" && IN_PERSON_WEEKDAYS.has(day)) {
      const start = zonedDateTimeToUTC(date, "09:00", STYLIST_SCHEDULE_TIME_ZONE);
      if (start.getTime() <= now.getTime() + leadTime) continue;
      const end = zonedDateTimeToUTC(date, "17:00", STYLIST_SCHEDULE_TIME_ZONE);
      slots.push({
        start,
        end,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        ...labels(start, end, displayTimeZone, serviceType),
      });
    }
  }

  return slots;
}

function overlaps(
  slot: { start: Date; end: Date },
  booking: { starts_at: string; ends_at: string }
) {
  return slot.start < new Date(booking.ends_at) && slot.end > new Date(booking.starts_at);
}

async function bookingContext(requestedTimeZone?: string | null) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();

  return {
    userId: user.id,
    timeZone: safeTimeZone(requestedTimeZone || profile?.timezone),
    serviceSupabase: createServiceSupabase(),
  };
}

export async function GET(request: NextRequest) {
  const context = await bookingContext(request.nextUrl.searchParams.get("timezone"));
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestedService = request.nextUrl.searchParams.get("service");
  if (!isServiceType(requestedService)) {
    return NextResponse.json({ error: "Unknown stylist service" }, { status: 400 });
  }

  const generated = generateSlots(requestedService, context.timeZone);
  const first = generated[0];
  const last = generated.at(-1);
  if (!first || !last) {
    const empty: StylistSlotsResponse = {
      serviceType: requestedService,
      timezone: context.timeZone,
      scheduleTimezone: STYLIST_SCHEDULE_TIME_ZONE,
      slots: [],
    };
    return NextResponse.json(empty);
  }

  const { data: bookings, error } = await context.serviceSupabase
    .from("stylist_bookings")
    .select("starts_at, ends_at")
    .in("status", ACTIVE_BOOKING_STATUSES)
    .lt("starts_at", last.endsAt)
    .gt("ends_at", first.startsAt);

  if (error) {
    console.error("Stylist availability error:", error);
    return NextResponse.json(
      { error: "Stylist booking is not configured yet. Run the latest schema migration." },
      { status: 503 }
    );
  }

  const limit = requestedService === "online_30" ? 24 : 12;
  const slots = generated
    .filter((slot) => !(bookings || []).some((booking) => overlaps(slot, booking)))
    .slice(0, limit)
    .map(({ startsAt, endsAt, dateLabel, timeLabel }) => ({
      startsAt,
      endsAt,
      dateLabel,
      timeLabel,
    }));

  const result: StylistSlotsResponse = {
    serviceType: requestedService,
    timezone: context.timeZone,
    scheduleTimezone: STYLIST_SCHEDULE_TIME_ZONE,
    slots,
  };
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    serviceType?: unknown;
    startsAt?: unknown;
    timezone?: unknown;
  };
  const context = await bookingContext(
    typeof body.timezone === "string" ? body.timezone : null
  );
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isServiceType(body.serviceType) || typeof body.startsAt !== "string") {
    return NextResponse.json({ error: "A valid service and slot are required" }, { status: 400 });
  }

  const slot = generateSlots(body.serviceType, context.timeZone).find(
    (candidate) => candidate.startsAt === body.startsAt
  );
  if (!slot) {
    return NextResponse.json({ error: "That slot is no longer offered" }, { status: 400 });
  }

  const { data: conflict, error: conflictError } = await context.serviceSupabase
    .from("stylist_bookings")
    .select("id")
    .in("status", ACTIVE_BOOKING_STATUSES)
    .lt("starts_at", slot.endsAt)
    .gt("ends_at", slot.startsAt)
    .limit(1)
    .maybeSingle();

  if (conflictError) {
    console.error("Stylist conflict check error:", conflictError);
    return NextResponse.json(
      { error: "Stylist booking is not configured yet. Run the latest schema migration." },
      { status: 503 }
    );
  }
  if (conflict) {
    return NextResponse.json({ error: "That slot was just booked. Choose another." }, { status: 409 });
  }

  const { data: booking, error } = await context.serviceSupabase
    .from("stylist_bookings")
    .insert({
      user_id: context.userId,
      service_type: body.serviceType,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      timezone: context.timeZone,
      status: "confirmed",
    })
    .select("id, service_type, starts_at, ends_at, timezone, status")
    .single();

  if (error || !booking) {
    const conflictCode = error?.code === "23P01";
    return NextResponse.json(
      { error: conflictCode ? "That slot was just booked. Choose another." : error?.message || "Booking failed" },
      { status: conflictCode ? 409 : 500 }
    );
  }

  const result: StylistBooking = {
    id: booking.id,
    serviceType: booking.service_type as StylistServiceType,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    timezone: booking.timezone,
    scheduleTimezone: STYLIST_SCHEDULE_TIME_ZONE,
    status: booking.status as StylistBooking["status"],
    ...labels(
      new Date(booking.starts_at),
      new Date(booking.ends_at),
      booking.timezone,
      booking.service_type as StylistServiceType
    ),
  };
  return NextResponse.json(result, { status: 201 });
}
