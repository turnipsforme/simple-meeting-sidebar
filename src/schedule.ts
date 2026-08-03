import type { RefreshSchedule } from "./models";
import { localDateKey, parseDailyTime } from "./utils";

const SCHEDULE_MINUTES: Partial<Record<RefreshSchedule, number>> = {
  "60": 60,
  "360": 360,
  "720": 720,
  weekly: 7 * 24 * 60,
};

export function automaticRefreshIsDue(
  schedule: RefreshSchedule,
  cachedDate: string,
  lastSuccessfulRefreshAt: number,
  dailyRefreshTime: string,
  now: Date,
): boolean {
  if (schedule === "manual") return false;
  if (schedule === "daily") {
    if (cachedDate === localDateKey(now)) return false;
    const parsed = parseDailyTime(dailyRefreshTime);
    if (!parsed) return false;

    const latestScheduledRefresh = new Date(now);
    latestScheduledRefresh.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (latestScheduledRefresh.getTime() > now.getTime()) {
      latestScheduledRefresh.setDate(latestScheduledRefresh.getDate() - 1);
    }
    return lastSuccessfulRefreshAt < latestScheduledRefresh.getTime();
  }
  const minutes = SCHEDULE_MINUTES[schedule];
  if (!minutes || lastSuccessfulRefreshAt <= 0) return true;
  return now.getTime() - lastSuccessfulRefreshAt >= minutes * 60_000;
}
