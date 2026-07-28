import assert from "node:assert/strict";
import test from "node:test";
import {
  findLongestPersonKey,
  insertMeetingLinkIntoDailyNote,
  insertTaskIntoDailyNote,
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
  const input = "# Today\n- Meeting\n\t- [[Meetings/Old|Old]]\n### Tasks";
  const result = insertMeetingLinkIntoDailyNote(input, "[[Meetings/New|New]]");
  assert.equal(
    result.content,
    "# Today\n- Meeting\n\t- [[Meetings/Old|Old]]\n\t- [[Meetings/New|New]]\n### Tasks",
  );
});

test("meeting link goes directly below the first heading when no Meeting bullet exists", () => {
  const result = insertMeetingLinkIntoDailyNote("# Today\n### Tasks", "[[Meetings/New|New]]");
  assert.equal(result.content, "# Today\n- [[Meetings/New|New]]\n### Tasks");
});

test("meeting numbering continues from the highest existing suffix", () => {
  assert.equal(nextMeetingBasename("Mentorship", ["Mentorship", "Mentorship 2", "Mentorship 7"]), "Mentorship 8");
  assert.equal(nextMeetingBasename("Mentorship", ["Other note"]), "Mentorship");
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
