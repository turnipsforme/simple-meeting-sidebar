import assert from "node:assert/strict";
import test from "node:test";
import { formatMeetingTime, meetingTaskTitle, insertTaskIntoDailyNote } from "../src/utils";
import type { CalendarEvent } from "../src/models";

const event: CalendarEvent = {
  id: "1", key: "1", title: "Meeting with John", start: new Date(2026, 8, 20, 10, 30).toISOString(),
  end: new Date(2026, 8, 20, 11).toISOString(), calendar: "Work", hasGoogleMeet: false, allDay: false,
};

test("task time is opt-in, local, and handles midnight, noon and all-day events", () => {
  assert.equal(meetingTaskTitle(event, false), "Meeting with John");
  assert.equal(meetingTaskTitle(event, true), "10:30am Meeting with John");
  assert.equal(formatMeetingTime({ start: new Date(2026, 8, 20, 0, 5).toISOString(), allDay: false }), "12:05am");
  assert.equal(formatMeetingTime({ start: new Date(2026, 8, 20, 12, 0).toISOString(), allDay: false }), "12:00pm");
  assert.equal(meetingTaskTitle({ ...event, allDay: true }, true), "Meeting with John");
});

test("a timed task is not duplicated on repeat insertion", () => {
  const title = meetingTaskTitle(event, true);
  const first = insertTaskIntoDailyNote("# Today\n\n### Tasks\n- [ ]\n", title);
  assert.match(first.content, /- \[ \] 10:30am Meeting with John/);
  assert.equal(insertTaskIntoDailyNote(first.content, title).changed, false);
});
