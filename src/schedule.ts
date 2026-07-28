import type { RefreshSchedule } from "./models";
import { localDateKey, parseDailyTime } from "./utils";

const SCHEDULE_MINUTES: Partial<Record<RefreshSchedule, number>> = {
  "60": 60,
  "360": 360,
  "720": 720,
  weekly: 7 * 24 * 60,
};

export interface NextRefreshInput {
  schedule: RefreshSchedule;
  dailyRefreshTime: string;
  cachedDate: string;
  lastSuccessfulRefreshAt: number;
  lastAttemptAt: number;
  now: Date;
}

/** Computes one timer delay. A successful or attempted daily refresh guarantees at most one query that day. */
export function computeNextRefreshDelay(input: NextRefreshInput): number | null {
  if (input.schedule === "manual") return null;
  const nowTime = input.now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  if (input.schedule === "daily") {
    const parsed = parseDailyTime(input.dailyRefreshTime);
    if (!parsed) return null;
    const next = new Date(nowTime);
    next.setHours(parsed.hours, parsed.minutes, 0, 0);
    const today = localDateKey(input.now);
    const attemptedToday = input.lastAttemptAt > 0
      && localDateKey(new Date(input.lastAttemptAt)) === today;
    if (input.cachedDate === today || attemptedToday || next.getTime() <= nowTime) {
      next.setDate(next.getDate() + 1);
      next.setHours(parsed.hours, parsed.minutes, 0, 0);
    }
    return Math.max(1_000, next.getTime() - nowTime);
  }

  const minutes = SCHEDULE_MINUTES[input.schedule];
  if (!minutes) return null;
  const anchor = Math.max(input.lastSuccessfulRefreshAt, input.lastAttemptAt);
  const runAt = anchor > 0 ? anchor + minutes * 60_000 : nowTime + minutes * 60_000;
  return Math.max(1_000, runAt - nowTime);
}

export function automaticRefreshIsDue(
  schedule: RefreshSchedule,
  cachedDate: string,
  lastSuccessfulRefreshAt: number,
  now: Date,
): boolean {
  if (schedule === "manual") return false;
  if (schedule === "daily") return cachedDate !== localDateKey(now);
  const minutes = SCHEDULE_MINUTES[schedule];
  if (!minutes || lastSuccessfulRefreshAt <= 0) return true;
  return now.getTime() - lastSuccessfulRefreshAt >= minutes * 60_000;
}
