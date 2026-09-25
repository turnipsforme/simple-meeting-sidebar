import assert from "node:assert/strict";
import test from "node:test";
import {
  eventsStartingOnLocalDate,
  filterCalendarEvents,
  mergeRefreshedEventState,
} from "../src/event-filter";
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

test("events can be split into local calendar days", () => {
  const yesterday = { ...events[0]!, start: "2026-07-27T09:00:00.000Z" };
  assert.deepEqual(
    eventsStartingOnLocalDate([yesterday, ...events], "2026-07-28").map((event) => event.id),
    events.map((event) => event.id),
  );
  assert.deepEqual(eventsStartingOnLocalDate([yesterday, ...events], "2026-07-27"), [yesterday]);
});

test("refreshes preserve action state but only automatic refreshes preserve sidebar hiding", () => {
  const fresh = events[0]!;
  const previous = {
    ...fresh,
    taskAdded: true,
    meetingNotePath: "Meetings/work-meet.md",
    sidebarHidden: true,
  };

  assert.deepEqual(mergeRefreshedEventState([fresh], [previous], true), [previous]);
  assert.deepEqual(mergeRefreshedEventState([fresh], [previous], false), [{
    ...fresh,
    taskAdded: true,
    meetingNotePath: "Meetings/work-meet.md",
  }]);
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

test("meeting-link filtering includes Zoom and Teams helper results and legacy Meet caches", () => {
  const zoom = { ...events[1]!, id: "zoom", hasMeetingLink: true };
  const teams = { ...events[1]!, id: "teams", hasMeetingLink: true };
  assert.deepEqual(filterCalendarEvents([zoom, teams, ...events], ["Work"], true).map((event) => event.id),
    ["zoom", "teams", "work-meet"]);
});

test("notification dismissal is independent of sidebar hiding and reset by manual refresh", () => {
  const fresh = events[0]!;
  const previous = { ...fresh, notificationHidden: true };
  const automatic = mergeRefreshedEventState([fresh], [previous], true)[0]!;
  assert.equal(automatic.notificationHidden, true);
  assert.equal(automatic.sidebarHidden, undefined);
  assert.deepEqual(mergeRefreshedEventState([fresh], [previous], false), [fresh]);
});


test("all-day and repeating filters compose with calendars and meeting links", () => {
  const allDay = { ...events[0]!, id: "all-day", allDay: true };
  const recurring = { ...events[0]!, id: "recurring", isRecurring: true };
  const input = [...events, allDay, recurring];
  assert.deepEqual(filterCalendarEvents(input, ["Work"], true, true, true).map(e => e.id), ["work-meet"]);
  assert.equal(filterCalendarEvents(input, null, false, false, false).length, 5);
  assert.equal(filterCalendarEvents(input, null, false, true, false).length, 4);
  assert.equal(filterCalendarEvents(input, null, false, false, true).length, 4);
});
