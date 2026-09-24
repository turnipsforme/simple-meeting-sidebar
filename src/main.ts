import type { Extension } from "@codemirror/state";
import { Notice, Platform, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import type { CalendarService } from "./calendar-service";
import { calendarWindow, coversLocalDate, NOTIFICATION_MAX_AGE_MS, parseSnapshot, SNAPSHOT_PATH, snapshotAllowsNotifications, type CalendarSnapshot } from "./calendar-snapshot";
import { DismissalStore, DISMISSALS_PATH } from "./dismissal-store";
import { SnapshotStore } from "./snapshot-store";
import { DailyNoteService } from "./daily-note-service";
import {
  filterCalendarEvents,
  eventDateReader,
  mergeRefreshedEventState,
} from "./event-filter";
import { MeetingNotifications } from "./meeting-notifications";
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

  private dailyNotes!: DailyNoteService;
  private notifications: MeetingNotifications | null = null;
  private readonly notificationExtensions: Extension[] = [];
  private readonly busyEvents = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private calendarService: CalendarService | null = null;
  private snapshotStore!: SnapshotStore;
  private dismissals!: DismissalStore;
  private snapshot: CalendarSnapshot | null = null;
  private snapshotVerified = false;
  private snapshotGeneration = 0;
  private clockTimer: number | null = null;
  private stopped = false;
  private settingsSave: Promise<void> = Promise.resolve();
  private device = { id: "" };
  private meetingService!: MeetingService;
  private scheduleTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private animateRefreshStatus = false;
  private lastRefreshError = "";
  private indexedEvents: CalendarEvent[] | null = null;
  private readonly eventsByDate = new Map<string, CalendarEvent[]>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerEditorExtension(this.notificationExtensions);
    const dailyNotes = this.dailyNotes = new DailyNoteService(this.app);
    this.peopleIndex = new PeopleIndex(
      this.app,
      () => this.settings.peopleFolder,
      () => this.settings.considerAliases,
      () => this.settings.ignoredPeople,
    );
    this.snapshotStore = new SnapshotStore(this.app);
    this.dismissals = new DismissalStore(this.app);
    await this.dismissals.load();
    this.dismissals.apply(this.settings.cachedEvents);
    this.meetingService = new MeetingService(
      this.app,
      dailyNotes,
      this.peopleIndex,
      () => this.settings.meetingsFolder,
      () => this.settings.addMeetingNotesToDailyNote,
      () => this.settings.includeMeetingTimeInTask,
    );

    this.registerView(
      SIMPLE_MEETING_SIDEBAR_VIEW,
      (leaf: WorkspaceLeaf) => new SimpleMeetingSidebarView(leaf, this),
    );
    this.addSettingTab(new SimpleMeetingSidebarSettingTab(this.app, this));

    this.addCommand({
      id: "refresh-todays-meetings",
      name: this.isSnapshotReader() ? "Reload synced meetings" : "Refresh today's meetings",
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
    this.register(() => {
      this.stopped = true;
      this.snapshotGeneration++;
      this.clearSchedule();
      if (this.clockTimer !== null) window.clearTimeout(this.clockTimer);
    });
    const snapshotChanged = (path: string) => {
      if (path.startsWith(`${DISMISSALS_PATH}/`)) {
        void this.dismissals.read(path).then(() => {
          if (this.stopped) return;
          this.dismissals.apply(this.settings.cachedEvents);
          this.saveLocalState();
          this.renderViews();
        });
        return;
      }
      if (path !== SNAPSHOT_PATH || !this.isSnapshotReader()) return;
      this.snapshotGeneration++;
      this.snapshotVerified = false;
      this.renderViews();
      void this.refreshToday().catch(() => undefined);
    };
    this.registerEvent(this.app.vault.on("create", (file) => snapshotChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => snapshotChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => snapshotChanged(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (oldPath === SNAPSHOT_PATH) snapshotChanged(oldPath);
      else snapshotChanged(file.path);
    }));
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.onResume();
    });
    this.registerDomEvent(window, "focus", () => this.onResume());

    this.app.workspace.onLayoutReady(() => {
      this.configureNotifications();
      if (!Platform.isMobile && !this.settings.sidebarInitialized) void this.initializeSidebar();
      this.scheduleClock();
      if (this.isSnapshotReader()) void this.refreshToday().catch(() => undefined);
      else this.configureSchedule();
    });
  }

  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  shouldAnimateRefreshStatus(): boolean { return this.animateRefreshStatus; }

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
    const calendars = this.isSnapshotReader() ? [] : await (await this.getCalendarService()).listCalendars();
    return [...new Set([...calendars, ...this.settings.cachedEvents.map((event) => event.calendar)])]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  getCachedDate(): string {
    return this.hasCoverage(new Date()) ? localDateKey(new Date()) : "";
  }

  getLastRefreshTime(): number { return this.settings.lastSuccessfulRefreshAt; }

  getLastError(): string { return this.lastRefreshError; }

  canUseAppleCalendar(): boolean { return Platform.isMacOS && !Platform.isMobile; }
  isSnapshotReader(): boolean { return !this.canUseAppleCalendar(); }
  isPublishing(): boolean { return this.canUseAppleCalendar(); }

  getNotificationEvents(date = new Date()): CalendarEvent[] {
    if (this.isSnapshotReader() && (!snapshotAllowsNotifications(this.snapshot, this.snapshotVerified)
      || !this.calendarSelectionMatches())) return [];
    return this.getEventsForDate(localDateKey(date))
      .filter((event) => !event.sidebarHidden && (event.allDay || Date.parse(event.start) > Date.now()));
  }

  shouldHideInlineNotifications(): boolean {
    return !Platform.isMobile && this.settings.notificationsOnlyWhenSidebarHidden
      && this.app.workspace.rightSplit?.collapsed === false;
  }

  getCalendarStatus(): string {
    if (!this.snapshot && !this.settings.lastSuccessfulRefreshAt) {
      return this.isSnapshotReader() ? "Waiting for a calendar snapshot from your Mac." : "Calendar has not been refreshed yet.";
    }
    const updated = new Date(this.getLastRefreshTime()).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const suffix = this.isSnapshotReader() && (!this.snapshotVerified || !this.calendarSelectionMatches())
      ? " Waiting for calendar sync." : "";
    return `Calendar updated ${updated}.${suffix}`;
  }

  hasCoverage(date: Date): boolean {
    if (this.snapshot) return coversLocalDate(this.snapshot, date);
    // Legacy caches cover only the publisher's refresh day and the day before it.
    const key = localDateKey(date);
    const previous = new Date(`${this.settings.cachedDate}T12:00:00`);
    previous.setDate(previous.getDate() - 1);
    return !this.isSnapshotReader() && !!this.settings.cachedDate
      && (key === this.settings.cachedDate || key === localDateKey(previous));
  }

  private calendarSelectionMatches(): boolean {
    const selected = this.settings.selectedCalendars;
    const published = this.snapshot?.selectedCalendars;
    return selected === null ? published === null : Array.isArray(published)
      && selected.length === published.length && selected.every((name) => published.includes(name));
  }

  private async getCalendarService(): Promise<CalendarService> {
    if (!this.canUseAppleCalendar()) throw new Error("Apple Calendar needs a Mac.");
    if (!this.calendarService) {
      const { CalendarService } = await import("./calendar-service");
      this.calendarService = new CalendarService(this);
    }
    return this.calendarService;
  }

  async refreshToday(manual = false, animateStatus = false): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.animateRefreshStatus = animateStatus;
    const operation = this.isSnapshotReader() ? this.reloadSnapshot(manual) : this.performRefresh(manual);
    this.refreshPromise = operation;
    this.renderViews();
    try {
      await operation;
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = null;
      this.scheduleClock();
      this.renderViews();
    }
  }

  async addEventAsTask(event: CalendarEvent, date?: Date): Promise<void> {
    const changed = await this.meetingService.addTask(event, date);
    await this.updateEventState(event.key, { taskAdded: true, sidebarHidden: true });
    const day = date && localDateKey(date) !== localDateKey(new Date()) ? "tomorrow's" : "today's";
    new Notice(changed ? `Added “${event.title}” to ${day} tasks.` : `“${event.title}” is already in ${day} tasks.`);
  }

  async createEventMeeting(event: CalendarEvent, date?: Date): Promise<void> {
    if (event.meetingNotePath) {
      const existing = this.app.vault.getAbstractFileByPath(event.meetingNotePath);
      if (existing instanceof TFile) {
        await this.updateEventState(event.key, { sidebarHidden: true });
        await this.app.workspace.getLeaf(false).openFile(existing);
        return;
      }
    }

    const result = await this.meetingService.createMeeting(event, date);
    if (!result) return;
    await this.updateEventState(event.key, {
      meetingNotePath: result.file.path,
      sidebarHidden: true,
    });
    if (result.warning) new Notice(`Simple Meeting Sidebar: ${result.warning}`);
  }

  configureSchedule(): void {
    this.clearSchedule();
    if (this.settings.refreshSchedule === "manual" || this.isSnapshotReader()) return;
    this.scheduleTimer = window.setInterval(
      () => this.checkAutomaticRefresh(),
      AUTOMATIC_REFRESH_POLL_MS,
    );
    this.checkAutomaticRefresh();
  }

  async saveSettings(): Promise<void> {
    const localKeys = new Set(["cachedEvents", "cachedDate", "lastSuccessfulRefreshAt", "sidebarInitialized"]);
    const shared = Object.fromEntries(Object.entries(this.settings).filter(([key]) => !localKeys.has(key)));
    const save = this.settingsSave.catch(() => undefined).then(() => this.saveData(shared));
    this.settingsSave = save;
    await save;
  }

  async onExternalSettingsChange(): Promise<void> {
    const current = this.settings;
    this.settings = { ...loadPluginSettings(await this.loadData()),
      cachedEvents: current.cachedEvents, cachedDate: current.cachedDate,
      lastSuccessfulRefreshAt: current.lastSuccessfulRefreshAt, sidebarInitialized: current.sidebarInitialized };
    this.peopleIndex.invalidate();
    this.configureNotifications();
    this.configureSchedule();
    this.renderViews();
    if (this.isSnapshotReader() || JSON.stringify(current.selectedCalendars) !== JSON.stringify(this.settings.selectedCalendars)) {
      await this.refreshToday().catch(() => undefined);
    }
  }

  private saveLocalState(): void {
    this.app.saveLocalStorage(`${this.manifest.id}:device`, {
      ...this.device, snapshot: this.snapshot ? { ...this.snapshot, events: undefined } : null,
      cachedEvents: this.settings.cachedEvents, cachedDate: this.settings.cachedDate,
      lastSuccessfulRefreshAt: this.settings.lastSuccessfulRefreshAt,
      sidebarInitialized: this.settings.sidebarInitialized,
    });
  }

  private async loadSettings(): Promise<void> {
    const storedData: unknown = await this.loadData();
    this.settings = loadPluginSettings(storedData);
    const saved: unknown = this.app.loadLocalStorage(`${this.manifest.id}:device`);
    const local = saved && typeof saved === "object" ? saved as Record<string, unknown> : null;
    this.device = {
      id: typeof local?.id === "string" ? local.id : crypto.randomUUID(),
    };
    if (local) {
      const state = loadPluginSettings(local);
      this.settings.cachedEvents = state.cachedEvents;
      this.settings.cachedDate = state.cachedDate;
      this.settings.lastSuccessfulRefreshAt = state.lastSuccessfulRefreshAt;
      this.settings.sidebarInitialized = state.sidebarInitialized;
      try {
        const header = local.snapshot as CalendarSnapshot;
        this.snapshot = parseSnapshot(JSON.stringify({ ...header,
          events: filterCalendarEvents(state.cachedEvents, header.selectedCalendars, false) }));
      } catch { this.snapshot = null; }
    } else if (this.isSnapshotReader()) {
      this.settings.cachedEvents = [];
      this.settings.cachedDate = "";
      this.settings.lastSuccessfulRefreshAt = 0;
    }
    if (storedData == null && !local) this.settings.sidebarInitialized = false;
    this.saveLocalState();
  }

  private async reloadSnapshot(manual: boolean): Promise<void> {
    let generation: number;
    do {
      generation = this.snapshotGeneration;
      try {
        const incoming = await this.snapshotStore.read();
        if (this.stopped || !this.isSnapshotReader()) return;
        if (generation !== this.snapshotGeneration) continue;
        if (this.snapshot && incoming.generatedAt < this.snapshot.generatedAt) {
          this.snapshotVerified = false;
          return;
        }
        if (this.snapshot && incoming.generatedAt === this.snapshot.generatedAt) {
          this.snapshotVerified = JSON.stringify(incoming) === JSON.stringify(this.snapshot);
          if (!this.snapshotVerified || !manual) return;
        }
        this.settings.cachedEvents = mergeRefreshedEventState(incoming.events, this.settings.cachedEvents, true);
        this.dismissals.apply(this.settings.cachedEvents);
        this.snapshot = incoming;
        this.settings.cachedDate = localDateKey(new Date(incoming.generatedAt));
        this.settings.lastSuccessfulRefreshAt = incoming.generatedAt;
        this.snapshotVerified = true;
        this.lastRefreshError = "";
        this.saveLocalState();
      } catch {
        this.snapshotVerified = false;
      }
    } while (!this.stopped && generation !== this.snapshotGeneration);
  }

  private onResume(): void {
    if (this.stopped) return;
    void this.dismissals.load().then(() => {
      if (this.stopped) return;
      this.dismissals.apply(this.settings.cachedEvents);
      this.saveLocalState();
      this.renderViews();
    });
    this.indexedEvents = null; // Local dates may have changed after travelling.
    this.scheduleClock();
    if (this.isSnapshotReader()) {
      this.snapshotGeneration++;
      this.snapshotVerified = false;
      this.renderViews();
      void this.refreshToday().catch(() => undefined);
    } else {
      this.renderViews();
      this.checkAutomaticRefresh();
    }
  }

  private scheduleClock(): void {
    if (this.clockTimer !== null) window.clearTimeout(this.clockTimer);
    if (this.stopped) return;
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const expires = (this.snapshot?.generatedAt ?? 0) + NOTIFICATION_MAX_AGE_MS;
    let next = this.isSnapshotReader() && expires > Date.now() ? Math.min(expires, midnight.getTime()) : midnight.getTime();
    for (const event of this.settings.cachedEvents) {
      const start = Date.parse(event.start);
      if (!event.allDay && start > Date.now()) next = Math.min(next, start);
    }
    this.clockTimer = window.setTimeout(() => {
      this.renderViews();
      this.scheduleClock();
    }, Math.max(50, next - Date.now() + 25));
  }

  private async initializeSidebar(): Promise<void> {
    try {
      await this.activateView();
      this.settings.sidebarInitialized = true;
      this.saveLocalState();
    } catch (error: unknown) {
      console.error("Simple Meeting Sidebar: could not initialize the sidebar", error);
    }
  }

  private async performRefresh(manual: boolean): Promise<void> {
    this.lastRefreshError = "";
    try {
      const generatedAt = Date.now();
      const selectedCalendars = this.settings.selectedCalendars?.slice() ?? null;
      const { start, end } = calendarWindow(new Date(generatedAt));
      const freshEvents = await (await this.getCalendarService()).fetchRange(start, end);
      if (this.stopped || this.isSnapshotReader()) return;
      if (JSON.stringify(selectedCalendars) !== JSON.stringify(this.settings.selectedCalendars)) {
        return await this.performRefresh(manual);
      }
      const snapshot = parseSnapshot(JSON.stringify({
        version: 1, publisher: this.device.id, generatedAt,
        coverageStart: start.toISOString(), coverageEnd: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        selectedCalendars, events: filterCalendarEvents(freshEvents, selectedCalendars, false),
      }));
      this.settings.cachedEvents = mergeRefreshedEventState(freshEvents, this.settings.cachedEvents, true);
      this.dismissals.apply(this.settings.cachedEvents);
      this.snapshot = snapshot;
      this.settings.cachedDate = localDateKey(new Date(generatedAt));
      this.settings.lastSuccessfulRefreshAt = generatedAt;
      this.saveLocalState();
      if (this.isPublishing()) {
        try { await this.snapshotStore.publish(snapshot); }
        catch (error) {
          console.warn("Simple Meeting Sidebar: snapshot publication deferred", error);
          this.lastRefreshError = "Meetings refreshed on this Mac. Calendar sync is waiting for the snapshot file to be writable.";
        }
      }
      if (manual) {
        const count = this.getTodayEvents().length;
        new Notice(`Simple Meeting Sidebar: found ${count} event${count === 1 ? "" : "s"} today.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apple Calendar could not be refreshed.";
      this.lastRefreshError = message;
      console.error("Simple Meeting Sidebar: refresh failed", error);
      if (manual) new Notice(`Simple Meeting Sidebar: ${message}`, 8000);
      throw error;
    }
  }

  private async updateEventState(
    eventKey: string,
    patch: Partial<Pick<CalendarEvent, "taskAdded" | "meetingNotePath" | "sidebarHidden" | "notificationHidden">>,
    animateLayout = false,
  ): Promise<void> {
    const event = this.settings.cachedEvents.find((candidate) => candidate.key === eventKey);
    if (!event) return;
    Object.assign(event, patch);
    this.saveLocalState();
    if (animateLayout) this.notifications?.prepareDismissal(eventKey);
    this.renderViews();
    if (patch.sidebarHidden || patch.notificationHidden) {
      await this.dismissals.dismiss(event, patch.sidebarHidden ? "sidebar" : "notification");
    }
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
    if (!this.hasCoverage(new Date(`${dateKey}T12:00:00`))) return [];
    if (this.indexedEvents !== this.settings.cachedEvents) {
      this.eventsByDate.clear();
      const dateKeyForEvent = eventDateReader(this.snapshot?.timeZone);
      for (const event of this.settings.cachedEvents) {
        const day = dateKeyForEvent(event);
        const group = this.eventsByDate.get(day);
        if (group) group.push(event);
        else this.eventsByDate.set(day, [event]);
      }
      this.indexedEvents = this.settings.cachedEvents;
    }
    return filterCalendarEvents(this.eventsByDate.get(dateKey) ?? [],
      this.settings.selectedCalendars, this.settings.onlyMeetingLinkEvents);
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
    await this.runEventAction(event, () => action(event));
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

  configureNotifications(): void {
    if (this.settings.meetingNotifications && !this.notifications) {
      this.notifications = new MeetingNotifications(this, this.dailyNotes);
      this.addChild(this.notifications);
      this.notificationExtensions.push(this.notifications.extension);
      this.app.workspace.updateOptions();
    } else if (!this.settings.meetingNotifications && this.notifications) {
      this.notificationExtensions.length = 0;
      this.app.workspace.updateOptions();
      this.removeChild(this.notifications);
      this.notifications = null;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isEventBusy(key: string): boolean {
    return this.busyEvents.has(key);
  }

  async runEventAction(event: CalendarEvent, action: () => Promise<void>): Promise<void> {
    if (this.busyEvents.has(event.key)) return;
    this.busyEvents.add(event.key);
    this.renderViews();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The action could not be completed.";
      console.error("Simple Meeting Sidebar: meeting action failed", error);
      new Notice(`Simple Meeting Sidebar: ${message}`);
    } finally {
      this.busyEvents.delete(event.key);
      this.renderViews();
    }
  }

  async dismissEvent(event: CalendarEvent, notificationOnly = false, animateLayout = false): Promise<void> {
    await this.updateEventState(event.key, notificationOnly
      ? { notificationHidden: true }
      : { sidebarHidden: true }, notificationOnly && animateLayout);
  }

  renderViews(): void {
    for (const listener of this.listeners) listener();
    for (const leaf of this.app.workspace.getLeavesOfType(SIMPLE_MEETING_SIDEBAR_VIEW)) {
      if (leaf.view instanceof SimpleMeetingSidebarView) leaf.view.render();
    }
  }
}
