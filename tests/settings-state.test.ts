import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/models";
import { loadPluginSettings, readCalendarEvent } from "../src/settings-state";
import { makeEventKey } from "../src/utils";

test("settings loader uses safe defaults for missing and malformed values", () => {
  const loaded = loadPluginSettings({
    meetingsFolder: 42,
    peopleFolder: ["People"],
    considerAliases: "yes",
    selectedCalendars: "Work",
    onlyGoogleMeetEvents: "yes",
    monochromeNotifications: "true",
    refreshSchedule: "constantly",
    dailyRefreshTime: "25:99",
    cachedDate: "2026-02-30",
    cachedEvents: {},
    lastSuccessfulRefreshAt: -1,
  });

  assert.deepEqual(loaded, DEFAULT_SETTINGS);
  assert.notEqual(loaded.cachedEvents, DEFAULT_SETTINGS.cachedEvents);
});

test("settings loader normalizes user folders and accepts known refresh values", () => {
  const loaded = loadPluginSettings({
    meetingsFolder: "/ Work / Meetings /",
    peopleFolder: "People/../Clients",
    considerAliases: false,
    selectedCalendars: [" Personal ", "Work", "Work", 42],
    onlyGoogleMeetEvents: true,
    addMeetingNotesToDailyNote: false,
    refreshSchedule: "360",
    dailyRefreshTime: "07:45",
  });

  assert.equal(loaded.meetingsFolder, "Work/Meetings");
  assert.equal(loaded.peopleFolder, "People/Clients");
  assert.equal(loaded.considerAliases, false);
  assert.deepEqual(loaded.selectedCalendars, ["Personal", "Work"]);
  assert.equal(loaded.onlyMeetingLinkEvents, true);
  assert.equal(loaded.addMeetingNotesToDailyNote, false);
  assert.equal(loaded.refreshSchedule, "360");
  assert.equal(loaded.dailyRefreshTime, "07:45");
});

test("cached events are validated, bounded, and assigned a trusted key", () => {
  const base = {
    id: "event-1",
    title: "  ⭐ Planning  ",
    start: "2026-07-25T09:00:00.000Z",
    end: "2026-07-25T09:30:00.000Z",
    allDay: false,
    calendar: "Work",
    hasGoogleMeet: true,
  };
  const loaded = loadPluginSettings({
    cachedDate: "2026-07-25",
    lastSuccessfulRefreshAt: 1234,
    cachedEvents: [
      {
        ...base,
        key: "untrusted-key",
        location: "  Dublin  ",
        taskAdded: true,
        meetingNotePath: " Meetings/Planning.md ",
        sidebarHidden: true,
      },
      { title: "Bad date", start: "nope", end: base.end },
      null,
    ],
  });

  assert.equal(loaded.cachedEvents.length, 1);
  assert.deepEqual(loaded.cachedEvents[0], {
    ...base,
    title: "Planning",
    key: makeEventKey({ ...base, title: "Planning" }),
    location: "Dublin",
    taskAdded: true,
    meetingNotePath: "Meetings/Planning.md",
    sidebarHidden: true,
  });
  assert.equal(loaded.cachedDate, "2026-07-25");
  assert.equal(loaded.lastSuccessfulRefreshAt, 1234);
});

test("an explicitly empty calendar selection is preserved", () => {
  const loaded = loadPluginSettings({ selectedCalendars: [] });
  assert.deepEqual(loaded.selectedCalendars, []);
});

test("existing settings do not trigger sidebar setup after upgrading", () => {
  const loaded = loadPluginSettings({ meetingsFolder: "Meetings" });
  assert.equal(loaded.sidebarInitialized, true);
});

test("an incomplete sidebar setup can be retried", () => {
  const loaded = loadPluginSettings({ sidebarInitialized: false });
  assert.equal(loaded.sidebarInitialized, false);
});

test("notifications default to neutral colors, migrate the Meet filter, and respect saved choices", () => {
  const defaults = loadPluginSettings({});
  assert.equal(defaults.meetingNotifications, false);
  assert.equal(defaults.monochromeNotifications, true);
  assert.equal(loadPluginSettings({ monochromeNotifications: false }).monochromeNotifications, false);
  assert.equal(defaults.includeMeetingTimeInTask, false);
  assert.equal(loadPluginSettings({ onlyGoogleMeetEvents: true }).onlyMeetingLinkEvents, true);
  const current = loadPluginSettings({ onlyGoogleMeetEvents: true, onlyMeetingLinkEvents: false,
    meetingNotifications: true, monochromeNotifications: true, includeMeetingTimeInTask: true });
  assert.equal(current.onlyMeetingLinkEvents, false);
  assert.equal(current.meetingNotifications, true);
  assert.equal(current.monochromeNotifications, true);
  assert.equal(current.includeMeetingTimeInTask, true);
});

test("meeting-link detection and notification dismissal survive reloads", () => {
  const result = loadPluginSettings({ cachedEvents: [{ id: "zoom", title: "Zoom meeting",
    start: "2026-09-20T10:00:00Z", end: "2026-09-20T11:00:00Z", calendar: "Work",
    hasMeetingLink: true, notificationHidden: true }] });
  assert.equal(result.cachedEvents[0]?.hasMeetingLink, true);
  assert.equal(result.cachedEvents[0]?.notificationHidden, true);
  assert.equal(result.cachedEvents[0]?.sidebarHidden, undefined);
});

test("fresh helper events cannot import saved action or dismissal state", () => {
  const result = readCalendarEvent({ id: "1", title: "Meeting", start: "2026-09-20T10:00:00Z",
    end: "2026-09-20T11:00:00Z", taskAdded: true, sidebarHidden: true,
    notificationHidden: true, meetingNotePath: "Meetings/Meeting.md", hasMeetingLink: true }, false);
  assert.equal(result?.hasMeetingLink, true);
  assert.equal(result?.taskAdded, undefined);
  assert.equal(result?.sidebarHidden, undefined);
  assert.equal(result?.notificationHidden, undefined);
  assert.equal(result?.meetingNotePath, undefined);
});
