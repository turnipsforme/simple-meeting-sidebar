import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyNoteDayLabel,
  findLongestPersonKey,
  formatDailyNoteLinkLabel,
  insertMeetingLinkIntoDailyNote,
  insertTaskIntoDailyNote,
  localDayOffset,
  nextMeetingBasename,
  normalizePersonText,
  normalizeVaultFolder,
  parseDailyTime,
  sanitizeMeetingTitle,
  stripEmojis,
} from "../src/utils";

test("task insertion detects an emoji tasks heading and consumes its empty placeholder", () => {
  const input = "# Today\n### ⭐ Tasks:\n- [ ] \n### Notes\n- keep me";
  const result = insertTaskIntoDailyNote(input, "Mentorship");
  assert.equal(result.content, "# Today\n### ⭐ Tasks:\n- [ ] Mentorship\n### Notes\n- keep me");
  assert.equal(result.changed, true);
});

test("task insertion creates a heading beneath the first daily heading", () => {
  const result = insertTaskIntoDailyNote("# Today\nA note", "Mentorship");
  assert.equal(result.content, "# Today\n\n### Tasks\n- [ ] Mentorship\n\nA note");
});

test("task insertion is idempotent even after the task is completed", () => {
  const input = "# Today\n### Tasks\n- [x] Mentorship";
  assert.deepEqual(insertTaskIntoDailyNote(input, "Mentorship"), { content: input, changed: false });
});

test("task insertion keeps calendar titles on a single markdown line", () => {
  const result = insertTaskIntoDailyNote("# Today\n### Tasks", "Planning\n- injected line");
  assert.equal(result.content, "# Today\n### Tasks\n- [ ] Planning - injected line");
});

test("meeting link nests under an existing Meeting bullet", () => {
  const input = "# Today\n- Meeting\n  - [[Meetings/Old|Old]]\n### Tasks";
  const result = insertMeetingLinkIntoDailyNote(input, "[[Meetings/New|New]]");
  assert.equal(
    result.content,
    "# Today\n- Meeting\n  - [[Meetings/Old|Old]]\n  - [[Meetings/New|New]]\n### Tasks",
  );
});

test("meeting link creates a nested Meeting bullet below the first heading", () => {
  const result = insertMeetingLinkIntoDailyNote("# Today\n### Tasks", "[[Meetings/New|New]]");
  assert.equal(result.content, "# Today\n- Meeting\n  - [[Meetings/New|New]]\n### Tasks");
});

test("meeting link creates a nested Meeting bullet at the top when there is no heading", () => {
  const result = insertMeetingLinkIntoDailyNote("A note", "[[Meetings/New|New]]");
  assert.equal(result.content, "- Meeting\n  - [[Meetings/New|New]]\nA note");
});

test("meeting numbering continues from the highest existing suffix", () => {
  assert.equal(
    nextMeetingBasename("Mentorship", ["Mentorship", "Mentorship 2", "Mentorship 7", "Mentorship 12 - project update"]),
    "Mentorship 13",
  );
  assert.equal(nextMeetingBasename("Mentorship", ["Other note"]), "Mentorship");
});

test("daily-note links use a readable date label", () => {
  assert.equal(formatDailyNoteLinkLabel(new Date(2026, 7, 3)), "Mon, Aug 3 2026");
});

test("longest person lookup matches aliases without scanning every person", () => {
  const map = new Map<string, number>([
    [normalizePersonText("Alex"), 1],
    [normalizePersonText("Alex Smith"), 2],
    [normalizePersonText("Mía Calderón"), 3],
  ]);
  assert.equal(findLongestPersonKey("Mentorship with Alex Smith", map, 2), "alex smith");
  assert.equal(findLongestPersonKey("Catch-up: Mia Calderon", map, 2), "mia calderon");
});

test("paths, titles, and daily time input are safely normalized", () => {
  assert.equal(normalizeVaultFolder("/People/../Trusted/", "People"), "People/Trusted");
  assert.equal(sanitizeMeetingTitle(" Project / review: next? "), "Project - review- next-");
  assert.deepEqual(parseDailyTime("08:30"), { hours: 8, minutes: 30 });
  assert.equal(parseDailyTime("25:00"), null);
});

test("emoji stripping removes standalone and joined emoji without damaging text", () => {
  assert.equal(stripEmojis("🏃 Easy Run ⭐"), "Easy Run");
  assert.equal(stripEmojis("Planning 👩🏽‍💻 with Mía"), "Planning with Mía");
  assert.equal(stripEmojis("Team 1:1 #3"), "Team 1:1 #3");
});

test("day offsets and action labels follow local calendar days across DST", () => {
  const now = new Date(2026, 9, 22, 23, 30);
  assert.equal(localDayOffset(now, new Date(2026, 9, 23, 0, 5)), 1);
  assert.equal(localDayOffset(now, new Date(2026, 9, 29, 12)), 7);
  // Spans the end of daylight saving time in Europe and North America.
  assert.equal(localDayOffset(new Date(2026, 9, 20), new Date(2026, 10, 3)), 14);
  assert.equal(dailyNoteDayLabel(undefined, now), "today's");
  assert.equal(dailyNoteDayLabel(new Date(2026, 9, 22, 8), now), "today's");
  assert.equal(dailyNoteDayLabel(new Date(2026, 9, 23, 8), now), "tomorrow's");
  assert.equal(dailyNoteDayLabel(new Date(2026, 9, 26, 8), now), "Monday's");
});
