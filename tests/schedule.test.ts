import assert from "node:assert/strict";
import test from "node:test";
import { automaticRefreshIsDue, computeNextRefreshDelay } from "../src/schedule";

const MINUTE = 60_000;

test("manual schedule owns no timer", () => {
  assert.equal(computeNextRefreshDelay({
    schedule: "manual",
    dailyRefreshTime: "08:00",
    cachedDate: "",
    lastSuccessfulRefreshAt: 0,
    lastAttemptAt: 0,
    now: new Date(2026, 6, 25, 7, 0),
  }), null);
});

test("daily waits for this morning when today has not been attempted", () => {
  const now = new Date(2026, 6, 25, 7, 30);
  assert.equal(computeNextRefreshDelay({
    schedule: "daily",
    dailyRefreshTime: "08:00",
    cachedDate: "2026-07-24",
    lastSuccessfulRefreshAt: 0,
    lastAttemptAt: 0,
    now,
  }), 30 * MINUTE);
});

test("daily schedules tomorrow after a same-day catch-up, even before 08:00", () => {
  const now = new Date(2026, 6, 25, 7, 30);
  const tomorrow = new Date(2026, 6, 26, 8, 0);
  assert.equal(computeNextRefreshDelay({
    schedule: "daily",
    dailyRefreshTime: "08:00",
    cachedDate: "2026-07-25",
    lastSuccessfulRefreshAt: now.getTime(),
    lastAttemptAt: now.getTime(),
    now,
  }), tomorrow.getTime() - now.getTime());
});

test("interval schedule keeps its cadence from the last completed refresh", () => {
  const now = new Date(2026, 6, 25, 10, 30);
  const lastRefresh = new Date(2026, 6, 25, 10, 0).getTime();
  assert.equal(computeNextRefreshDelay({
    schedule: "60",
    dailyRefreshTime: "08:00",
    cachedDate: "2026-07-25",
    lastSuccessfulRefreshAt: lastRefresh,
    lastAttemptAt: lastRefresh,
    now,
  }), 30 * MINUTE);
});

test("due checks catch up once per new day or elapsed interval", () => {
  const now = new Date(2026, 6, 25, 12, 0);
  assert.equal(automaticRefreshIsDue("daily", "2026-07-24", 0, now), true);
  assert.equal(automaticRefreshIsDue("daily", "2026-07-25", 0, now), false);
  assert.equal(automaticRefreshIsDue("60", "", now.getTime() - 59 * MINUTE, now), false);
  assert.equal(automaticRefreshIsDue("60", "", now.getTime() - 60 * MINUTE, now), true);
});
