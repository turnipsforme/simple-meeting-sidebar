import type { CalendarEvent, RefreshSchedule, StoredPluginSettings } from "./models";
import { DEFAULT_SETTINGS } from "./models";
import { makeEventKey, normalizeVaultFolder, parseDailyTime, replaceControlCharacters, stripEmojis } from "./utils";

const REFRESH_SCHEDULES = new Set<RefreshSchedule>(["manual", "60", "360", "720", "daily", "weekly"]);
const MAX_CACHED_EVENTS = 10_000;

/** Treat data.json as untrusted input: old versions, sync conflicts, and manual edits can all change its shape. */
export function loadPluginSettings(value: unknown): StoredPluginSettings {
  const raw = isRecord(value) ? value : {};

  return {
    sidebarInitialized: typeof raw.sidebarInitialized === "boolean"
      ? raw.sidebarInitialized
      : DEFAULT_SETTINGS.sidebarInitialized,
    meetingsFolder: normalizeVaultFolder(readString(raw.meetingsFolder), DEFAULT_SETTINGS.meetingsFolder),
    peopleFolder: normalizeVaultFolder(readString(raw.peopleFolder), DEFAULT_SETTINGS.peopleFolder),
    considerAliases: typeof raw.considerAliases === "boolean"
      ? raw.considerAliases
      : DEFAULT_SETTINGS.considerAliases,
    ignoredPeople: typeof raw.ignoredPeople === "string" ? raw.ignoredPeople.slice(0, 2_000) : "",
    sidebarPillOffset: typeof raw.sidebarPillOffset === "number" && Number.isFinite(raw.sidebarPillOffset)
      ? Math.min(800, Math.max(0, raw.sidebarPillOffset))
      : DEFAULT_SETTINGS.sidebarPillOffset,
    selectedCalendars: readSelectedCalendars(raw.selectedCalendars),
    onlyGoogleMeetEvents: typeof raw.onlyGoogleMeetEvents === "boolean"
      ? raw.onlyGoogleMeetEvents
      : DEFAULT_SETTINGS.onlyGoogleMeetEvents,
    addMeetingNotesToDailyNote: typeof raw.addMeetingNotesToDailyNote === "boolean"
      ? raw.addMeetingNotesToDailyNote
      : DEFAULT_SETTINGS.addMeetingNotesToDailyNote,
    refreshSchedule: isRefreshSchedule(raw.refreshSchedule)
      ? raw.refreshSchedule
      : DEFAULT_SETTINGS.refreshSchedule,
    dailyRefreshTime: isDailyTime(raw.dailyRefreshTime)
      ? raw.dailyRefreshTime
      : DEFAULT_SETTINGS.dailyRefreshTime,
    cachedDate: isDateKey(raw.cachedDate) ? raw.cachedDate : "",
    cachedEvents: readCachedEvents(raw.cachedEvents),
    lastSuccessfulRefreshAt: readTimestamp(raw.lastSuccessfulRefreshAt),
  };
}

export function isRefreshSchedule(value: unknown): value is RefreshSchedule {
  return typeof value === "string" && REFRESH_SCHEDULES.has(value as RefreshSchedule);
}

function readCachedEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];
  const events: CalendarEvent[] = [];

  for (const raw of value.slice(0, MAX_CACHED_EVENTS)) {
    const event = readCachedEvent(raw);
    if (event) events.push(event);
  }
  return events;
}

function readCachedEvent(value: unknown): CalendarEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string" || typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  if (!Number.isFinite(Date.parse(value.start)) || !Number.isFinite(Date.parse(value.end))) return null;

  const title = stripEmojis(compactSingleLine(value.title, 500)) || "Untitled event";
  const base = {
    id: typeof value.id === "string" ? value.id.slice(0, 500) : "",
    title,
    start: value.start,
    end: value.end,
    allDay: value.allDay === true,
    calendar: typeof value.calendar === "string" ? compactSingleLine(value.calendar, 200) : "",
    hasGoogleMeet: value.hasGoogleMeet === true,
  };
  const location = typeof value.location === "string" && value.location.trim()
    ? compactSingleLine(value.location, 500)
    : undefined;
  const meetingNotePath = typeof value.meetingNotePath === "string" && value.meetingNotePath.trim()
    ? value.meetingNotePath.trim().slice(0, 1_000)
    : undefined;
  const guests = Array.isArray(value.guests)
    ? value.guests
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => compactSingleLine(entry, 200))
      .filter(Boolean)
      .slice(0, 200)
    : undefined;

  return {
    ...base,
    key: makeEventKey(base),
    ...(location ? { location } : {}),
    ...(value.taskAdded === true ? { taskAdded: true } : {}),
    ...(meetingNotePath ? { meetingNotePath } : {}),
    ...(guests && guests.length > 0 ? { guests } : {}),
    ...(value.sidebarHidden === true ? { sidebarHidden: true } : {}),
  };
}

function readSelectedCalendars(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const calendars = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => compactSingleLine(entry, 200))
    .filter(Boolean);
  return [...new Set(calendars)].sort((left, right) => left.localeCompare(right));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compactSingleLine(value: string, maximumLength: number): string {
  return replaceControlCharacters(value).replace(/\s+/g, " ").trim().slice(0, maximumLength).trim();
}

function isDailyTime(value: unknown): value is string {
  return typeof value === "string" && parseDailyTime(value) !== null;
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function readTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
