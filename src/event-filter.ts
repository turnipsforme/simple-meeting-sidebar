import type { CalendarEvent } from "./models";

export function filterCalendarEvents(
  events: readonly CalendarEvent[],
  selectedCalendars: readonly string[] | null,
  onlyGoogleMeetEvents: boolean,
): CalendarEvent[] {
  const selected = selectedCalendars === null ? null : new Set(selectedCalendars);
  return events.filter((event) =>
    (selected === null || selected.has(event.calendar))
    && (!onlyGoogleMeetEvents || event.hasGoogleMeet));
}
