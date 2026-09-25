import { ItemView, Modal, Platform, TFile, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import type { CalendarEvent } from "./models";
import { formatMeetingTime } from "./utils";
import { RefreshStatus } from "./refresh-status";
import { waitForNotificationExit } from "./notification-motion";

export const SIMPLE_MEETING_SIDEBAR_VIEW = "simple-meeting-sidebar-view";

export interface CalendarEventGroups {
  today: CalendarEvent[];
  yesterday: CalendarEvent[];
}

export interface SimpleMeetingSidebarController {
  getTodayEvents(): CalendarEvent[];
  getTodayAndYesterdayEvents(): CalendarEventGroups;
  getCachedDate(): string;
  getLastError(): string;
  getCalendarStatus(): string;
  hasCoverage(date: Date): boolean;
  isRefreshing(): boolean;
  shouldAnimateRefreshStatus(): boolean;
  refreshToday(manual?: boolean, animateStatus?: boolean): Promise<void>;
  toggleSidebar(): Promise<void>;
  getPillOffset(): number;
  setPillOffset(value: number): Promise<void>;
  addEventAsTask(event: CalendarEvent, date?: Date): Promise<void>;
  createEventMeeting(event: CalendarEvent, date?: Date): Promise<void>;
  dismissEvent(event: CalendarEvent, notificationOnly?: boolean, animateLayout?: boolean): Promise<void>;
  isEventBusy(key: string): boolean;
  runEventAction(event: CalendarEvent, action: () => Promise<void>): Promise<void>;
  subscribe(listener: () => void): () => void;
  app: App;
}

export class SimpleMeetingSidebarView extends ItemView {
  private readonly decoratedWorkspaceElements = new Set<HTMLElement>();
  private refreshStatus: RefreshStatus | undefined;
  private body: HTMLElement | undefined;
  private pill: HTMLElement | undefined;

  constructor(leaf: WorkspaceLeaf, private readonly controller: SimpleMeetingSidebarController) {
    super(leaf);
  }

  getViewType(): string {
    return SIMPLE_MEETING_SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return "Today's meetings";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    if (!Platform.isMobile) {
      this.decorateWorkspace();
      this.renderPill();
    }
    this.render();
  }

  async onClose(): Promise<void> {
    this.clearWorkspaceDecorations();
    this.refreshStatus?.dispose();
    this.refreshStatus = undefined;
    this.body = undefined;
    this.pill = undefined;
  }

  private decorateWorkspace(): void {
    this.clearWorkspaceDecorations();
    const content = this.containerEl.closest<HTMLElement>(".workspace-leaf-content");
    if (!content) return;

    this.addWorkspaceDecoration(content, "wcm-view-content");
    const leaf = content.closest<HTMLElement>(".workspace-leaf");
    const tabs = content.closest<HTMLElement>(".workspace-tabs");
    if (leaf) this.addWorkspaceDecoration(leaf, "wcm-view-leaf");
    if (!tabs) return;

    this.addWorkspaceDecoration(tabs, "wcm-view-tabs");
    for (const nestedLeaf of tabs.querySelectorAll<HTMLElement>(".workspace-leaf")) {
      this.addWorkspaceDecoration(nestedLeaf, "wcm-borderless-neighbor");
    }

    for (let sibling = tabs.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (!sibling.instanceOf(HTMLElement)) continue;
      this.addWorkspaceDecoration(sibling, "wcm-borderless-neighbor");
    }

    if (leaf) {
      for (let sibling = leaf.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (!sibling.instanceOf(HTMLElement)) continue;
        this.addWorkspaceDecoration(sibling, "wcm-borderless-neighbor");
      }
    }

    for (let sibling = tabs.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (!sibling.instanceOf(HTMLElement) || !sibling.matches(".workspace-split")) continue;
      for (const nestedLeaf of sibling.querySelectorAll<HTMLElement>(".workspace-leaf")) {
        this.addWorkspaceDecoration(nestedLeaf, "wcm-borderless-neighbor");
      }
    }
  }

  private addWorkspaceDecoration(element: HTMLElement, className: string): void {
    element.addClass(className);
    this.decoratedWorkspaceElements.add(element);
  }

  private clearWorkspaceDecorations(): void {
    for (const element of this.decoratedWorkspaceElements) {
      element.removeClass("wcm-view-content", "wcm-view-leaf", "wcm-view-tabs", "wcm-borderless-neighbor");
    }
    this.decoratedWorkspaceElements.clear();
  }

  /** Minimalist pill that replaces the tab icon/separator: click toggles the sidebar, drag moves it up/down. */
  private renderPill(): void {
    const existing = this.containerEl.querySelector(".wcm-pill");
    const pill = existing instanceof HTMLElement
      ? existing
      : this.containerEl.createDiv({ cls: "wcm-pill" });
    this.pill = pill;
    pill.setAttribute("aria-label", "Drag to move up/down · click to refresh today's meetings");
    pill.setAttr("title", "Simple Meeting Sidebar: drag to reposition, click to refresh today's meetings");

    let startY = 0;
    let startOffset = 0;
    let dragging = false;
    let moved = false;

    this.applyPillOffset(pill);

    pill.onmousedown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      startY = event.clientY;
      startOffset = this.controller.getPillOffset();
      event.preventDefault();
    };

    this.registerDomEvent(window, "mousemove", (event: MouseEvent) => {
      if (!dragging) return;
      const delta = event.clientY - startY;
      if (Math.abs(delta) < 4 && !moved) return;
      moved = true;
      const offset = Math.min(800, Math.max(0, startOffset + delta));
      this.contentEl.style.marginTop = `${offset}px`;
      pill.style.top = `${offset + 2}px`;
    });

    this.registerDomEvent(window, "mouseup", () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        void this.controller.refreshToday(false, true).catch(() => undefined);
        return;
      }
      const offset = Math.min(800, Math.max(0, Number.parseInt(this.contentEl.style.marginTop || "0", 10)));
      void this.controller.setPillOffset(offset).catch(() => undefined);
    });
  }

  private applyPillOffset(pill: HTMLElement): void {
    const offset = Math.min(800, Math.max(0, this.controller.getPillOffset()));
    this.contentEl.style.marginTop = `${offset}px`;
    pill.style.top = `${offset + 2}px`;
  }

  render(): void {
    this.contentEl.addClass("wcm-view");
    if (!this.refreshStatus || !this.body) {
      this.contentEl.empty();
      this.refreshStatus = new RefreshStatus(this.contentEl, this.pill);
      this.body = this.contentEl.createDiv({ cls: "wcm-view-body" });
    }
    this.refreshStatus.update(this.controller.isRefreshing(), this.controller.shouldAnimateRefreshStatus());
    const container = this.body;
    container.empty();
    const error = this.controller.getLastError();
    if (error && !Platform.isMobile) container.createDiv({ cls: "wcm-error", text: error });
    if (Platform.isMobile) this.renderMobileStatus(container);

    const events = this.controller.getTodayEvents();
    if (events.length === 0) {
      if (Platform.isMobile) {
        container.createDiv({ cls: "wcm-empty", text: this.controller.getCachedDate()
          ? "No meetings to show today." : "No calendar data for today yet." });
      } else if (!this.controller.getCachedDate()) {
        container.createDiv({ cls: "wcm-empty", text: "Today's calendar has not been refreshed yet. Click the pill above or use “Refresh today's meetings” in the command palette." });
      }
      return;
    }

    const list = container.createDiv({ cls: "wcm-event-list" });
    for (const event of events) {
      renderEventRow(list, event, this.controller, "sidebar");
    }
  }

  private renderMobileStatus(container: HTMLElement): void {
    container.createDiv({ cls: "wcm-calendar-status", text: this.controller.getCalendarStatus() });
    const reload = container.createEl("button", {
      cls: "wcm-reload", text: "Reload synced meetings", attr: { type: "button" },
    });
    reload.disabled = this.controller.isRefreshing();
    reload.addEventListener("click", () => void this.controller.refreshToday(true).catch(() => undefined));
  }



}

export class CalendarEventsModal extends Modal {
  private opened = false;
  private unsubscribe: (() => void) | undefined;
  private refreshStatus: RefreshStatus | undefined;
  private body: HTMLElement | undefined;

  constructor(app: App, private readonly controller: SimpleMeetingSidebarController) {
    super(app);
  }

  onOpen(): void {
    this.opened = true;
    this.unsubscribe = this.controller.subscribe(() => this.render());
    this.setTitle("Today's calendar events");
    this.modalEl.addClass("wcm-calendar-modal");
    this.render();
  }

  onClose(): void {
    this.opened = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.refreshStatus?.dispose();
    this.contentEl.empty();
    this.refreshStatus = undefined;
    this.body = undefined;
  }

  render(): void {
    if (!this.opened) return;
    if (!this.refreshStatus || !this.body) {
      this.contentEl.empty();
      this.refreshStatus = new RefreshStatus(this.contentEl);
      this.body = this.contentEl.createDiv({ cls: "wcm-view-body" });
    }
    this.refreshStatus.update(this.controller.isRefreshing(), this.controller.shouldAnimateRefreshStatus());
    const container = this.body;
    container.empty();
    const error = this.controller.getLastError();
    if (error && !Platform.isMobile) container.createDiv({ cls: "wcm-error", text: error });
    if (Platform.isMobile) container.createDiv({ cls: "wcm-calendar-status", text: this.controller.getCalendarStatus() });

    if (!this.controller.getCachedDate()) {
      if (!this.controller.isRefreshing()) {
        container.createDiv({ cls: "wcm-empty", text: "Calendar events are not available yet." });
      }
      return;
    }

    const groups = this.controller.getTodayAndYesterdayEvents();
    this.renderSection(container, "Today", groups.today, "No calendar events today.");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.renderSection(container, "Yesterday", groups.yesterday,
      Platform.isMobile && !this.controller.hasCoverage(yesterday) ? "No calendar data for yesterday." : "No calendar events yesterday.");
  }

  private renderSection(
    container: HTMLElement,
    heading: string,
    events: CalendarEvent[],
    emptyMessage: string,
  ): void {
    const section = container.createDiv({ cls: "wcm-modal-section" });
    section.createEl("h3", { cls: "wcm-modal-heading", text: heading });
    if (events.length === 0) {
      section.createDiv({ cls: "wcm-empty", text: emptyMessage });
      return;
    }

    const list = section.createDiv({ cls: "wcm-event-list" });
    for (const event of events) {
      renderEventRow(list, event, this.controller, "modal");
    }
  }


}

export function renderEventRow(
  list: HTMLElement,
  event: CalendarEvent,
  controller: SimpleMeetingSidebarController,
  surface: "sidebar" | "modal" | "notification",
  dailyNoteDate?: Date,
): void {
  const row = list.createDiv({ cls: "wcm-event" });
  if (controller.isEventBusy(event.key)) row.addClass("is-busy");

  const notification = surface === "notification";
  const content = notification ? row.createDiv({ cls: "wcm-notification-content" }) : row;
  if (notification) {
    row.addClass("wcm-notification");
    content.createSpan({ cls: "wcm-event-time", text: formatMeetingTime(event) });
  }
  const title = content.createSpan({ cls: "wcm-event-title", text: event.title });
  title.setAttr("title", event.title);

  const actions = row.createDiv({ cls: "wcm-event-actions" });
  // Keep editor selection and mobile swipe handlers out of button gestures.
  // Do not preventDefault: native focus, scrolling and click synthesis still work.
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown"]) {
    actions.addEventListener(type, (input) => input.stopPropagation());
  }
  const taskDay = dailyNoteDate && dailyNoteDate.toDateString() !== new Date().toDateString() ? "tomorrow's" : "today's";
  const taskButton = actions.createEl("button", {
    cls: notification ? "wcm-action wcm-notification-secondary clickable-icon" : "wcm-action",
    text: notification ? "" : "•",
    attr: {
      "aria-label": event.taskAdded ? `Already added to ${taskDay} tasks` : `Add to ${taskDay} tasks`,
      type: "button",
    },
  });
  if (notification) setIcon(taskButton, "list-todo");
  taskButton.disabled = controller.isEventBusy(event.key) || event.taskAdded === true;

  const existingMeeting = event.meetingNotePath
    ? controller.app.vault.getAbstractFileByPath(event.meetingNotePath)
    : null;
  const meetingCreated = existingMeeting instanceof TFile;
  const meetingButton = actions.createEl("button", {
    cls: notification ? "wcm-action wcm-notification-secondary clickable-icon" : "wcm-action",
    text: notification ? "" : "••",
    attr: {
      "aria-label": meetingCreated ? "Meeting note already created" : "Create meeting note",
      type: "button",
    },
  });
  if (notification) setIcon(meetingButton, "file-plus-2");
  meetingButton.disabled = controller.isEventBusy(event.key) || meetingCreated;

  if (surface !== "modal") {
    const label = surface === "notification" ? "Dismiss notification" : "Dismiss meeting";
    const closeButton = actions.createEl("button", {
      cls: notification ? "wcm-action wcm-notification-close clickable-icon" : "wcm-action",
      attr: { "aria-label": label, type: "button" },
    });
    setIcon(closeButton, "x");
    closeButton.disabled = controller.isEventBusy(event.key);
    closeButton.addEventListener("click", (mouseEvent) => {
      mouseEvent.stopPropagation();
      if (row.inert) return;
      const dismiss = () => controller.runEventAction(event,
        () => controller.dismissEvent(event, notification, notification && mouseEvent.detail > 0));
      // Keyboard activation is immediate. Mouse dismissal finishes its fade before
      // the shared event action updates every open daily-note pane.
      if (!notification || mouseEvent.detail === 0 || typeof row.getAnimations !== "function") {
        void dismiss();
        return;
      }
      row.inert = true;
      row.classList.add("is-dismissing");
      void waitForNotificationExit(row).then(async () => {
        // The live row holds the footer's height through the entire exit. Only
        // then hide it from paint and let the shared action remove its space.
        row.classList.add("is-dismissed");
        if (row.isConnected) await dismiss();
      }).finally(() => {
        // Keep successful dismissals hidden even if a pane redraw is deferred.
        // A failed action leaves the original row available to retry.
        if (!event.notificationHidden && !event.sidebarHidden) {
          row.inert = false;
          row.classList.remove("is-dismissing", "is-dismissed");
        }
      });
    });
  }

  taskButton.addEventListener("click", (mouseEvent) => {
    mouseEvent.stopPropagation();
    void controller.runEventAction(event, () => controller.addEventAsTask(event, dailyNoteDate));
  });
  meetingButton.addEventListener("click", (mouseEvent) => {
    mouseEvent.stopPropagation();
    void controller.runEventAction(event, () => controller.createEventMeeting(event, dailyNoteDate));
  });
}
