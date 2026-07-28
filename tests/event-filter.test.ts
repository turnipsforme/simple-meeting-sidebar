import assert from "node:assert/strict";
import test from "node:test";
import { filterCalendarEvents } from "../src/event-filter";
import type { CalendarEvent } from "../src/models";

const events: CalendarEvent[] = [
  makeEvent("work-meet", "Work", true),
  makeEvent("work-offline", "Work", false),
  makeEvent("personal-meet", "Personal", true),
];

test("calendar filtering treats null as all calendars and an empty list as none", () => {
  assert.deepEqual(filterCalendarEvents(events, null, false), events);
  assert.deepEqual(filterCalendarEvents(events, [], false), []);
  assert.deepEqual(
    filterCalendarEvents(events, ["Personal"], false).map((event) => event.id),
    ["personal-meet"],
  );
});

test("Google Meet filtering composes with the selected calendars", () => {
  assert.deepEqual(
    filterCalendarEvents(events, ["Work"], true).map((event) => event.id),
    ["work-meet"],
  );
});

function makeEvent(id: string, calendar: string, hasGoogleMeet: boolean): CalendarEvent {
  return {
    id,
    key: id,
    title: id,
    start: "2026-07-28T09:00:00.000Z",
    end: "2026-07-28T09:30:00.000Z",
    allDay: false,
    calendar,
    hasGoogleMeet,
  };
}
