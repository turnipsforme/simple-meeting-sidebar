import type { CalendarEvent } from "./models";
import { eventIdentity } from "./event-identity";
import { localDateKey } from "./utils";

export function filterCalendarEvents(
  events: readonly CalendarEvent[],
  selectedCalendars: readonly string[] | null,
  onlyMeetingLinkEvents: boolean,
): CalendarEvent[] {
  const selected = selectedCalendars === null ? null : new Set(selectedCalendars);
  return events.filter((event) =>
    (selected === null || selected.has(event.calendar))
    && (!onlyMeetingLinkEvents || (event.hasMeetingLink || event.hasGoogleMeet)));
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
  const previousIdentity = new Map(previousEvents.map((event) => [eventIdentity(event), event] as const));
  return freshEvents.map((event) => {
    const previous = previousState.get(event.key) ?? previousIdentity.get(eventIdentity(event));
    return {
      ...event,
      ...(previous?.taskAdded ? { taskAdded: true } : {}),
      ...(previous?.meetingNotePath ? { meetingNotePath: previous.meetingNotePath } : {}),
      ...(preserveSidebarHidden && previous?.sidebarHidden ? { sidebarHidden: true } : {}),
      ...(preserveSidebarHidden && previous?.notificationHidden ? { notificationHidden: true } : {}),
    };
  });
}

/** Timed meetings follow the device; all-day meetings retain the source calendar date. */
export function eventDateReader(sourceTimeZone?: string): (event: CalendarEvent) => string {
  const formatter = sourceTimeZone ? new Intl.DateTimeFormat("en", {
    timeZone: sourceTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }) : null;
  return (event) => {
    const date = new Date(event.start);
    if (!event.allDay || !formatter) return localDateKey(date);
    const parts = formatter.formatToParts(date);
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
  };
}
