import type { CalendarEvent } from "./models";
import { readCalendarEvent } from "./settings-state";

export const SNAPSHOT_PATH = "Meetings/_calendar/events.json";
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const NOTIFICATION_MAX_AGE_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface CalendarSnapshot {
  version: 1;
  publisher: string;
  // Fetch start, not completion: a slow request must not supersede a newer one.
  generatedAt: number;
  coverageStart: string;
  coverageEnd: string;
  timeZone: string;
  selectedCalendars: string[] | null;
  events: CalendarEvent[];
}

export function calendarWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 9);
  return { start, end };
}

export function parseSnapshot(text: string, now = Date.now()): CalendarSnapshot {
  if (text.length > MAX_SNAPSHOT_BYTES || new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) {
    throw new Error("Calendar snapshot is too large.");
  }
  const raw: unknown = JSON.parse(text);
  if (!record(raw) || raw.version !== 1 || typeof raw.publisher !== "string" || !raw.publisher
    || raw.publisher.length > 200 || typeof raw.generatedAt !== "number" || !Number.isFinite(raw.generatedAt)
    || raw.generatedAt <= 0 || raw.generatedAt > now + 60_000
    || !isoDate(raw.coverageStart) || !isoDate(raw.coverageEnd)
    || typeof raw.timeZone !== "string" || raw.timeZone.length > 100
    || !Array.isArray(raw.events) || raw.events.length > 10_000
    || !(raw.selectedCalendars === null || (Array.isArray(raw.selectedCalendars)
      && raw.selectedCalendars.length <= 1_000
      && raw.selectedCalendars.every((name) => typeof name === "string" && name.length <= 200)))) {
    throw new Error("Calendar snapshot is incomplete.");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: raw.timeZone }); } catch {
    throw new Error("Calendar snapshot has an invalid time zone.");
  }
  const start = Date.parse(raw.coverageStart);
  const end = Date.parse(raw.coverageEnd);
  if (end <= start || end - start > 10 * DAY_MS || raw.generatedAt < start || raw.generatedAt >= end) {
    throw new Error("Calendar snapshot has invalid coverage.");
  }
  const selected = raw.selectedCalendars === null ? null : new Set(raw.selectedCalendars as string[]);
  const keys = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const value of raw.events) {
    if (!record(value) || !isoDate(value.start) || !isoDate(value.end)
      || typeof value.id !== "string" || !value.id || value.id.length > 500
      || (value.externalId !== undefined && (typeof value.externalId !== "string" || value.externalId.length > 500))
      || typeof value.title !== "string" || value.title.length > 500
      || typeof value.calendar !== "string" || value.calendar.length > 200
      || typeof value.allDay !== "boolean" || typeof value.hasGoogleMeet !== "boolean"
      || (value.hasMeetingLink !== undefined && typeof value.hasMeetingLink !== "boolean")
      || (value.guests !== undefined && (!Array.isArray(value.guests) || value.guests.length > 200
        || !value.guests.every((guest) => typeof guest === "string" && guest.length <= 200)))
      || Date.parse(value.end) < Date.parse(value.start)
      || Date.parse(value.start) >= end || Date.parse(value.end) < start) {
      throw new Error("Calendar snapshot contains an invalid event.");
    }
    const event = readCalendarEvent(value, false);
    if (!event || keys.has(event.key)
      || (selected !== null && !selected.has(event.calendar))) {
      throw new Error("Calendar snapshot contains conflicting events.");
    }
    keys.add(event.key);
    events.push(event);
  }
  events.sort((a, b) => Number(b.allDay) - Number(a.allDay)
    || Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  return {
    version: 1, publisher: raw.publisher, generatedAt: raw.generatedAt,
    coverageStart: raw.coverageStart, coverageEnd: raw.coverageEnd, timeZone: raw.timeZone,
    selectedCalendars: raw.selectedCalendars as string[] | null, events,
  };
}

export function coversLocalDate(snapshot: CalendarSnapshot | null, date: Date): boolean {
  if (!snapshot) return false;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return start.getTime() >= Date.parse(snapshot.coverageStart) && end.getTime() <= Date.parse(snapshot.coverageEnd);
}

export function snapshotAllowsNotifications(snapshot: CalendarSnapshot | null, verified: boolean, now = new Date()): boolean {
  return verified && snapshot !== null && coversLocalDate(snapshot, now)
    && now.getTime() >= snapshot.generatedAt && now.getTime() < snapshot.generatedAt + NOTIFICATION_MAX_AGE_MS;
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
