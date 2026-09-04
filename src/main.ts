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
import { SimpleMeetingSidebarSettingTab } from "./settings";
import { loadPluginSettings } from "./settings-state";
import { localDateKey } from "./utils";
import {
  SIMPLE_MEETING_SIDEBAR_VIEW,
  CalendarEventsModal,
  SimpleMeetingSidebarView,
  type CalendarEventGroups,
  type SimpleMeetingSidebarController,
} from "./view";

const AUTOMATIC_REFRESH_POLL_MS = 5 * 60_000;

export default class SimpleMeetingSidebarPlugin extends Plugin implements SimpleMeetingSidebarController {
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
      () => this.settings.ignoredPeople,
    );
    this.calendarService = new CalendarService(this);
    this.meetingService = new MeetingService(
      this.app,
      dailyNotes,
      this.peopleIndex,
      () => this.settings.meetingsFolder,
      () => this.settings.addMeetingNotesToDailyNote,
    );

    this.registerView(
      SIMPLE_MEETING_SIDEBAR_VIEW,
      (leaf: WorkspaceLeaf) => new SimpleMeetingSidebarView(leaf, this),
    );
    this.addSettingTab(new SimpleMeetingSidebarSettingTab(this.app, this));

    this.addCommand({
      id: "refresh-todays-meetings",
      name: "Refresh today's meetings",
      callback: () => void this.refreshToday(true).catch(() => undefined),
    });
    this.addCommand({
      id: "show-todays-meetings",
      name: "Toggle meetings sidebar",
      callback: () => void this.toggleSidebar().catch((error: unknown) => {
        console.error("Simple Meeting Sidebar: could not toggle the sidebar", error);
      }),
    });
    this.addCommand({
      id: "add-next-meeting-as-task",
      name: "Add next meeting as task",
      callback: () => this.runOnNextEvent(
        "task",
        (event) => this.addEventAsTask(event),
      ),
    });
    this.addCommand({
      id: "create-next-meeting-note",
      name: "Create next meeting note",
      callback: () => this.runOnNextEvent(
        "meeting note",
        (event) => this.createEventMeeting(event),
      ),
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
      if (!this.settings.sidebarInitialized) void this.initializeSidebar();
      if (process.platform !== "darwin") {
        this.lastRefreshError = "Simple Meeting Sidebar is available on macOS only.";
        this.renderViews();
        return;
      }
      this.configureSchedule();
    });
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
      if (manual) new Notice(`Simple Meeting Sidebar: ${error.message}`);
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
    if (result.warning) new Notice(`Simple Meeting Sidebar: ${result.warning}`);
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
    const storedData: unknown = await this.loadData();
    this.settings = loadPluginSettings(storedData);
    if (storedData == null) this.settings.sidebarInitialized = false;
  }

  private async initializeSidebar(): Promise<void> {
    try {
      await this.activateView();
      this.settings.sidebarInitialized = true;
      await this.saveSettings();
    } catch (error: unknown) {
      console.error("Simple Meeting Sidebar: could not initialize the sidebar", error);
    }
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
        new Notice(`Simple Meeting Sidebar: found ${count} event${count === 1 ? "" : "s"} today.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apple Calendar could not be refreshed.";
      this.lastRefreshError = message;
      console.error("Simple Meeting Sidebar: refresh failed", error);
      new Notice(`Simple Meeting Sidebar: ${message}`, 8000);
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

  getPillOffset(): number {
    return Math.min(800, Math.max(0, this.settings.sidebarPillOffset));
  }

  async setPillOffset(value: number): Promise<void> {
    this.settings.sidebarPillOffset = Math.min(800, Math.max(0, value));
    await this.saveSettings();
  }

  private async runOnNextEvent(
    label: string,
    action: (event: CalendarEvent) => Promise<void>,
  ): Promise<void> {
    const event = this.getTodayEvents().find((candidate) => candidate.taskAdded !== true);
    if (!event) {
      new Notice(`Simple Meeting Sidebar: no upcoming meeting to add as a ${label}.`);
      return;
    }
    try {
      await action(event);
    } catch (error: unknown) {
      console.error(`Simple Meeting Sidebar: could not add the ${label}`, error);
      new Notice(`Simple Meeting Sidebar: could not add the ${label}.`);
    }
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIMPLE_MEETING_SIDEBAR_VIEW)[0];
    if (existing) {
      this.expandRightSidebar();
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(true);
    if (!leaf) return;
    await leaf.setViewState({ type: SIMPLE_MEETING_SIDEBAR_VIEW, active: true });
    this.expandRightSidebar();
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  async toggleSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIMPLE_MEETING_SIDEBAR_VIEW)[0];
    if (!existing) {
      await this.activateView();
      return;
    }
    const split = this.app.workspace.rightSplit as unknown as
      | { collapsed?: boolean; collapse?: () => void; expand?: () => void; width?: number }
      | undefined;
    if (split?.collapsed !== true) {
      split?.collapse?.();
    } else {
      split?.expand?.();
      this.app.workspace.setActiveLeaf(existing, { focus: true });
    }
  }

  private expandRightSidebar(): void {
    const split = this.app.workspace.rightSplit as unknown as { expand?: () => void } | undefined;
    split?.expand?.();
  }

  renderViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(SIMPLE_MEETING_SIDEBAR_VIEW)) {
      if (leaf.view instanceof SimpleMeetingSidebarView) leaf.view.render();
    }
  }
}
