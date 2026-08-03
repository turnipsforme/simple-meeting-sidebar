import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { CalendarService } from "./calendar-service";
import { DailyNoteService } from "./daily-note-service";
import {
  eventsStartingOnLocalDate,
  filterCalendarEvents,
  mergeRefreshedEventState,
} from "./event-filter";
import { MeetingService } from "./meeting-service";
import {
  type CalendarEvent,
  type StoredPluginSettings,
} from "./models";
import { PeopleIndex } from "./people-index";
import { automaticRefreshIsDue } from "./schedule";
import { CalendarMeetingsSettingTab } from "./settings";
import { loadPluginSettings } from "./settings-state";
import { localDateKey } from "./utils";
import {
  CALENDAR_MEETINGS_VIEW,
  CalendarEventsModal,
  CalendarMeetingsView,
  type CalendarEventGroups,
  type CalendarMeetingsController,
} from "./view";

const AUTOMATIC_REFRESH_POLL_MS = 5 * 60_000;

export default class CalendarMeetingsPlugin extends Plugin implements CalendarMeetingsController {
  declare settings: StoredPluginSettings;
  peopleIndex!: PeopleIndex;

  private calendarService!: CalendarService;
  private meetingService!: MeetingService;
  private scheduleTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private lastRefreshError = "";

  async onload(): Promise<void> {
    await this.loadSettings();
    const dailyNotes = new DailyNoteService(this.app);
    this.peopleIndex = new PeopleIndex(
      this.app,
      () => this.settings.peopleFolder,
      () => this.settings.considerAliases,
    );
    this.calendarService = new CalendarService(this);
    this.meetingService = new MeetingService(
      this.app,
      dailyNotes,
      this.peopleIndex,
      () => this.settings.meetingsFolder,
    );

    this.registerView(
      CALENDAR_MEETINGS_VIEW,
      (leaf: WorkspaceLeaf) => new CalendarMeetingsView(leaf, this),
    );
    this.addSettingTab(new CalendarMeetingsSettingTab(this.app, this));

    this.addCommand({
      id: "refresh-todays-meetings",
      name: "Refresh today's meetings",
      callback: () => void this.refreshToday(true).catch(() => undefined),
    });
    this.addCommand({
      id: "show-todays-meetings",
      name: "Show today's meetings",
      callback: () => void this.activateView().catch((error: unknown) => {
        console.error("Calendar Meetings: could not open the sidebar", error);
      }),
    });
    this.addCommand({
      id: "todays-calendar-events",
      name: "Today's calendar events",
      callback: () => this.showCalendarEvents(),
    });

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (this.peopleIndex.isPeoplePath(file.path)) this.peopleIndex.invalidate();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.peopleIndex.isPeoplePath(file.path) || this.peopleIndex.isPeoplePath(oldPath)) {
        this.peopleIndex.invalidate();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (this.peopleIndex.isPeoplePath(file.path)) this.peopleIndex.invalidate();
    }));
    this.register(() => this.clearSchedule());

    this.app.workspace.onLayoutReady(() => {
      void this.activateView().catch((error: unknown) => {
        console.error("Calendar Meetings: could not open the sidebar", error);
      });
      if (process.platform !== "darwin") {
        this.lastRefreshError = "Calendar Meetings is available on macOS only.";
        this.renderViews();
        return;
      }
      this.configureSchedule();
    });
  }

  onunload(): void {
    this.clearSchedule();
    this.app.workspace.detachLeavesOfType(CALENDAR_MEETINGS_VIEW);
  }

  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  getTodayEvents(): CalendarEvent[] {
    return this.getEventsForDate(localDateKey(new Date()))
      .filter((event) => event.sidebarHidden !== true);
  }

  getTodayAndYesterdayEvents(): CalendarEventGroups {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      today: this.getEventsForDate(localDateKey(today)),
      yesterday: this.getEventsForDate(localDateKey(yesterday)),
    };
  }

  async getAvailableCalendars(): Promise<string[]> {
    const calendars = await this.calendarService.listCalendars();
    return [...new Set([...calendars, ...this.settings.cachedEvents.map((event) => event.calendar)])]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  getCachedDate(): string {
    return this.settings.cachedDate === localDateKey(new Date()) ? this.settings.cachedDate : "";
  }

  getLastRefreshTime(): number {
    return this.settings.cachedDate === localDateKey(new Date())
      ? this.settings.lastSuccessfulRefreshAt
      : 0;
  }

  getLastError(): string {
    return this.lastRefreshError;
  }

  async refreshToday(manual = false): Promise<void> {
    if (process.platform !== "darwin") {
      const error = new Error("Apple Calendar access is supported on macOS only.");
      if (manual) new Notice(`Calendar Meetings: ${error.message}`);
      throw error;
    }
    if (this.refreshPromise) return this.refreshPromise;

    const operation = this.performRefresh(manual);
    this.refreshPromise = operation;
    this.renderViews();
    try {
      await operation;
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = null;
      this.renderViews();
    }
  }

  async addEventAsTask(event: CalendarEvent): Promise<void> {
    const changed = await this.meetingService.addTask(event);
    await this.updateEventState(event.key, { taskAdded: true, sidebarHidden: true });
    new Notice(changed ? `Added “${event.title}” to today's tasks.` : `“${event.title}” is already in today's tasks.`);
  }

  async createEventMeeting(event: CalendarEvent): Promise<void> {
    if (event.meetingNotePath) {
      const existing = this.app.vault.getAbstractFileByPath(event.meetingNotePath);
      if (existing instanceof TFile) {
        await this.updateEventState(event.key, { sidebarHidden: true });
        await this.app.workspace.getLeaf(false).openFile(existing);
        return;
      }
    }

    const result = await this.meetingService.createMeeting(event);
    await this.updateEventState(event.key, {
      meetingNotePath: result.file.path,
      sidebarHidden: true,
    });
    if (result.warning) new Notice(`Calendar Meetings: ${result.warning}`);
  }

  configureSchedule(): void {
    this.clearSchedule();
    if (this.settings.refreshSchedule === "manual" || process.platform !== "darwin") return;
    this.scheduleTimer = window.setInterval(
      () => this.checkAutomaticRefresh(),
      AUTOMATIC_REFRESH_POLL_MS,
    );
    this.checkAutomaticRefresh();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    this.settings = loadPluginSettings(await this.loadData());
  }

  private async performRefresh(manual: boolean): Promise<void> {
    this.lastRefreshError = "";
    try {
      const freshEvents = await this.calendarService.fetchTodayAndYesterday();
      this.settings.cachedEvents = mergeRefreshedEventState(
        freshEvents,
        this.settings.cachedEvents,
        !manual,
      );
      this.settings.cachedDate = localDateKey(new Date());
      this.settings.lastSuccessfulRefreshAt = Date.now();
      await this.saveSettings();
      if (manual) {
        const count = this.getTodayEvents().length;
        new Notice(`Calendar Meetings: found ${count} event${count === 1 ? "" : "s"} today.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apple Calendar could not be refreshed.";
      this.lastRefreshError = message;
      console.error("Calendar Meetings: refresh failed", error);
      new Notice(`Calendar Meetings: ${message}`, 8000);
      throw error;
    }
  }

  private async updateEventState(
    eventKey: string,
    patch: Partial<Pick<CalendarEvent, "taskAdded" | "meetingNotePath" | "sidebarHidden">>,
  ): Promise<void> {
    const event = this.settings.cachedEvents.find((candidate) => candidate.key === eventKey);
    if (!event) return;
    Object.assign(event, patch);
    await this.saveSettings();
    this.renderViews();
  }

  private refreshIsDue(): boolean {
    return automaticRefreshIsDue(
      this.settings.refreshSchedule,
      this.settings.cachedDate,
      this.settings.lastSuccessfulRefreshAt,
      this.settings.dailyRefreshTime,
      new Date(),
    );
  }

  private checkAutomaticRefresh(): void {
    if (!this.isRefreshing() && this.refreshIsDue()) {
      void this.refreshToday(false).catch(() => undefined);
    }
  }

  private clearSchedule(): void {
    if (this.scheduleTimer !== null) window.clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
  }

  private getEventsForDate(dateKey: string): CalendarEvent[] {
    if (this.settings.cachedDate !== localDateKey(new Date())) return [];
    return eventsStartingOnLocalDate(
      filterCalendarEvents(
        this.settings.cachedEvents,
        this.settings.selectedCalendars,
        this.settings.onlyGoogleMeetEvents,
      ),
      dateKey,
    );
  }

  private showCalendarEvents(): void {
    const modal = new CalendarEventsModal(this.app, this);
    modal.open();
    const refresh = this.refreshToday(true);
    modal.render();
    void refresh
      .catch(() => undefined)
      .finally(() => modal.render());
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(CALENDAR_MEETINGS_VIEW)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(true);
    if (!leaf) return;
    await leaf.setViewState({ type: CALENDAR_MEETINGS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  renderViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_MEETINGS_VIEW)) {
      if (leaf.view instanceof CalendarMeetingsView) leaf.view.render();
    }
  }
}
