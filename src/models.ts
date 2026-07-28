import type { TFile } from "obsidian";

export type RefreshSchedule = "manual" | "60" | "360" | "720" | "daily" | "weekly";

export interface CalendarEvent {
  id: string;
  key: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  hasGoogleMeet: boolean;
  location?: string;
  taskAdded?: boolean;
  meetingNotePath?: string;
}

export interface StoredPluginSettings {
  meetingsFolder: string;
  peopleFolder: string;
  considerAliases: boolean;
  selectedCalendars: string[] | null;
  onlyGoogleMeetEvents: boolean;
  refreshSchedule: RefreshSchedule;
  dailyRefreshTime: string;
  cachedDate: string;
  cachedEvents: CalendarEvent[];
  lastSuccessfulRefreshAt: number;
}

export const DEFAULT_SETTINGS: StoredPluginSettings = {
  meetingsFolder: "Meetings",
  peopleFolder: "People",
  considerAliases: true,
  selectedCalendars: null,
  onlyGoogleMeetEvents: false,
  refreshSchedule: "daily",
  dailyRefreshTime: "08:00",
  cachedDate: "",
  cachedEvents: [],
  lastSuccessfulRefreshAt: 0,
};

export interface PersonMatch {
  file: TFile;
  displayText: string;
  matchedByAlias: boolean;
}

export interface TextUpdateResult {
  content: string;
  changed: boolean;
}
