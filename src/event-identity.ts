import type { CalendarEvent } from "./models";

/** External ID crosses Macs; occurrence start distinguishes recurring instances. */
export function eventIdentity(event: CalendarEvent): string {
  return encodeURIComponent(JSON.stringify([event.externalId || event.id, event.calendar, event.start]));
}

export function eventTaskMarker(event: CalendarEvent): string {
  return `<!-- simple-meeting:${eventIdentity(event)} -->`;
}
