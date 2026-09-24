import assert from "node:assert/strict";
import test from "node:test";
import { calendarWindow, coversLocalDate, MAX_SNAPSHOT_BYTES, NOTIFICATION_MAX_AGE_MS, parseSnapshot, snapshotAllowsNotifications } from "../src/calendar-snapshot";
import { eventIdentity } from "../src/event-identity";
import { eventDateReader, mergeRefreshedEventState } from "../src/event-filter";

const now = Date.parse("2026-09-23T10:00:00.000Z");
const event = { id: "local-a", externalId: "shared-id", title: "Catch up", start: "2026-09-23T11:00:00.000Z", end: "2026-09-23T12:00:00.000Z", allDay: false, calendar: "Work", hasGoogleMeet: false };
function fixture(overrides = {}) {
  return { version: 1, publisher: "mac-a", generatedAt: now, coverageStart: "2026-09-22T00:00:00.000Z", coverageEnd: "2026-10-01T00:00:00.000Z", timeZone: "Europe/Dublin", selectedCalendars: ["Work"], events: [event], ...overrides };
}
const parse = (value: unknown) => parseSnapshot(JSON.stringify(value), now);

test("snapshot strips action state and unknown fields, keeps only selected calendar events", () => {
  const snapshot = parse(fixture({ events: [{ ...event, sidebarHidden: true, taskAdded: true, meetingNotePath: "secret.md", notes: "secret", notificationHidden: true }] }));
  assert.equal(snapshot.events[0]?.taskAdded, undefined);
  assert.equal(snapshot.events[0]?.meetingNotePath, undefined);
  assert.equal(snapshot.events[0]?.notificationHidden, undefined);
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
  assert.throws(() => parse(fixture({ events: [{ ...event, calendar: "Private" }] })));
});

test("malformed, truncated, huge and future files are rejected as a whole", () => {
  for (const text of ["{", "null", "[]", " ".repeat(MAX_SNAPSHOT_BYTES + 1)]) assert.throws(() => parseSnapshot(text, now));
  for (const changes of [
    { version: 2 }, { publisher: "" }, { generatedAt: now + 60_001 }, { generatedAt: -1 },
    { coverageEnd: "2026-09-21T00:00:00.000Z" }, { coverageEnd: "2026-10-20T00:00:00.000Z" },
    { timeZone: "Moon/Sea" }, { events: [event, event] }, { selectedCalendars: {} },
    { events: [event, {}] }, { events: [{ ...event, start: "2026-02-30T11:00:00.000Z" }] },
    { events: [{ ...event, end: "2026-09-23T10:00:00.000Z" }] },
    { events: [{ ...event, guests: [null] }] }, { events: [{ ...event, hasMeetingLink: "yes" }] },
  ]) assert.throws(() => parse(fixture(changes)), JSON.stringify(changes));
});

test("empty snapshots are valid cancellations, distinct from missing coverage", () => {
  const snapshot = parse(fixture({ events: [] }));
  assert.deepEqual(snapshot.events, []);
  assert.equal(coversLocalDate(snapshot, new Date(now)), true);
  assert.equal(coversLocalDate(snapshot, new Date("2026-10-10T12:00:00Z")), false);
  assert.equal(coversLocalDate(null, new Date(now)), false);
});

test("notifications require verified complete coverage, matching clock, and expire at one hour", () => {
  const snapshot = parse(fixture());
  assert.equal(snapshotAllowsNotifications(snapshot, true, new Date(now)), true);
  assert.equal(snapshotAllowsNotifications(snapshot, false, new Date(now)), false);
  assert.equal(snapshotAllowsNotifications(snapshot, true, new Date(now - 1)), false);
  assert.equal(snapshotAllowsNotifications(snapshot, true, new Date(now + NOTIFICATION_MAX_AGE_MS - 1)), true);
  assert.equal(snapshotAllowsNotifications(snapshot, true, new Date(now + NOTIFICATION_MAX_AGE_MS)), false);
  assert.equal(snapshotAllowsNotifications({ ...snapshot, coverageStart: "2026-09-23T10:00:00.000Z" }, true, new Date(now)), false);
});

test("calendar window uses calendar days across daylight saving and time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Europe/Dublin", "America/New_York", "Pacific/Auckland", "Asia/Kolkata"]) {
      process.env.TZ = zone;
      for (const date of [new Date(2026, 2, 28, 12), new Date(2026, 9, 24, 12)]) {
        const { start, end } = calendarWindow(date);
        assert.equal(start.getHours(), 0);
        assert.equal(end.getHours(), 0);
        const expected = new Date(date); expected.setHours(0, 0, 0, 0); expected.setDate(expected.getDate() + 8);
        assert.equal(end.getTime(), expected.getTime());
        const snapshot = parseSnapshot(JSON.stringify(fixture({ generatedAt: date.getTime(), coverageStart: start.toISOString(), coverageEnd: end.toISOString(), events: [] })), date.getTime());
        assert.equal(coversLocalDate(snapshot, date), true);
        assert.equal(coversLocalDate(snapshot, end), false);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("external identity survives a different Mac and title/end changes but separates recurring occurrences", () => {
  const original = parse(fixture()).events[0]!;
  const otherMac = { ...original, id: "local-b", key: "new-key", title: "Renamed", end: "2026-09-23T13:00:00.000Z" };
  assert.equal(eventIdentity(original), eventIdentity(otherMac));
  assert.notEqual(eventIdentity(original), eventIdentity({ ...otherMac, start: "2026-09-24T11:00:00.000Z" }));
  assert.equal(mergeRefreshedEventState([otherMac], [{ ...original, notificationHidden: true }], true)[0]?.notificationHidden, true);
});


test("all-day calendar dates survive travelling while timed meetings follow the phone time zone", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const readDate = eventDateReader("Europe/Dublin");
    const base = parse(fixture()).events[0]!;
    const midnightDublin = { ...base, start: "2026-09-22T23:00:00.000Z" };
    assert.equal(readDate({ ...midnightDublin, allDay: true }), "2026-09-23");
    assert.equal(readDate(midnightDublin), "2026-09-22");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
