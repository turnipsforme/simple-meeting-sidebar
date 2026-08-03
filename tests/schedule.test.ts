import assert from "node:assert/strict";
import test from "node:test";
import { automaticRefreshIsDue } from "../src/schedule";

const MINUTE = 60_000;

test("manual refresh never becomes automatically due", () => {
  assert.equal(automaticRefreshIsDue(
    "manual",
    "",
    0,
    "08:00",
    new Date(2026, 6, 25, 12, 0),
  ), false);
});

test("daily refresh waits for today's configured time after yesterday succeeded", () => {
  const now = new Date(2026, 6, 25, 7, 30);
  const yesterdayRefresh = new Date(2026, 6, 24, 8, 5).getTime();
  assert.equal(automaticRefreshIsDue(
    "daily",
    "2026-07-24",
    yesterdayRefresh,
    "08:00",
    now,
  ), false);
});

test("daily refresh becomes due after today's configured time", () => {
  const now = new Date(2026, 6, 25, 8, 1);
  const yesterdayRefresh = new Date(2026, 6, 24, 8, 5).getTime();
  assert.equal(automaticRefreshIsDue(
    "daily",
    "2026-07-24",
    yesterdayRefresh,
    "08:00",
    now,
  ), true);
});

test("daily refresh catches up before today's time when the previous scheduled run was missed", () => {
  const now = new Date(2026, 6, 25, 7, 30);
  const staleRefresh = new Date(2026, 6, 23, 8, 5).getTime();
  assert.equal(automaticRefreshIsDue(
    "daily",
    "2026-07-23",
    staleRefresh,
    "08:00",
    now,
  ), true);
});

test("a successful refresh today prevents a second automatic daily refresh", () => {
  const now = new Date(2026, 6, 25, 12, 0);
  assert.equal(automaticRefreshIsDue(
    "daily",
    "2026-07-25",
    now.getTime() - MINUTE,
    "08:00",
    now,
  ), false);
});

test("interval schedules catch up when their elapsed time has passed", () => {
  const now = new Date(2026, 6, 25, 12, 0);
  assert.equal(automaticRefreshIsDue("60", "", now.getTime() - 59 * MINUTE, "08:00", now), false);
  assert.equal(automaticRefreshIsDue("60", "", now.getTime() - 60 * MINUTE, "08:00", now), true);
});
