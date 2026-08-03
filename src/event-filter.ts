import type { CalendarEvent } from "./models";
import { localDateKey } from "./utils";

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

export function eventsStartingOnLocalDate(
  events: readonly CalendarEvent[],
  dateKey: string,
): CalendarEvent[] {
  return events.filter((event) => localDateKey(new Date(event.start)) === dateKey);
}

export function mergeRefreshedEventState(
  freshEvents: readonly CalendarEvent[],
  previousEvents: readonly CalendarEvent[],
  preserveSidebarHidden: boolean,
): CalendarEvent[] {
  const previousState = new Map(previousEvents.map((event) => [event.key, event] as const));
  return freshEvents.map((event) => {
    const previous = previousState.get(event.key);
    return {
      ...event,
      ...(previous?.taskAdded ? { taskAdded: true } : {}),
      ...(previous?.meetingNotePath ? { meetingNotePath: previous.meetingNotePath } : {}),
      ...(preserveSidebarHidden && previous?.sidebarHidden ? { sidebarHidden: true } : {}),
    };
  });
}
