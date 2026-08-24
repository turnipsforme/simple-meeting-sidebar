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
  guests?: string[];
  taskAdded?: boolean;
  meetingNotePath?: string;
  sidebarHidden?: boolean;
}

export interface StoredPluginSettings {
  sidebarInitialized: boolean;
  meetingsFolder: string;
  peopleFolder: string;
  considerAliases: boolean;
  ignoredPeople: string;
  sidebarPillOffset: number;
  selectedCalendars: string[] | null;
  onlyGoogleMeetEvents: boolean;
  refreshSchedule: RefreshSchedule;
  dailyRefreshTime: string;
  cachedDate: string;
  cachedEvents: CalendarEvent[];
  lastSuccessfulRefreshAt: number;
}

export const DEFAULT_SETTINGS: StoredPluginSettings = {
  sidebarInitialized: true,
  meetingsFolder: "Meetings",
  peopleFolder: "People",
  considerAliases: true,
  ignoredPeople: "",
  sidebarPillOffset: 0,
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
