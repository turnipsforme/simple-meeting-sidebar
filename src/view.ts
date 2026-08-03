import { ItemView, Modal, Notice, TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { CalendarEvent } from "./models";

export const CALENDAR_MEETINGS_VIEW = "wrens-calendar-meetings-view";

export interface CalendarEventGroups {
  today: CalendarEvent[];
  yesterday: CalendarEvent[];
}

export interface CalendarMeetingsController {
  getTodayEvents(): CalendarEvent[];
  getTodayAndYesterdayEvents(): CalendarEventGroups;
  getCachedDate(): string;
  getLastError(): string;
  isRefreshing(): boolean;
  addEventAsTask(event: CalendarEvent): Promise<void>;
  createEventMeeting(event: CalendarEvent): Promise<void>;
  app: App;
}

type EventActionRunner = (event: CalendarEvent, action: () => Promise<void>) => void;

export class CalendarMeetingsView extends ItemView {
  private readonly busyEvents = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly controller: CalendarMeetingsController) {
    super(leaf);
  }

  getViewType(): string {
    return CALENDAR_MEETINGS_VIEW;
  }

  getDisplayText(): string {
    return "Today's meetings";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("wcm-view");

    const error = this.controller.getLastError();
    if (error) container.createDiv({ cls: "wcm-error", text: error });

    const events = this.controller.getTodayEvents();
    if (events.length === 0) {
      const allTodayEvents = this.controller.getTodayAndYesterdayEvents().today;
      const message = !this.controller.getCachedDate()
        ? "Today's calendar has not been refreshed yet. Use “Refresh today's meetings” in the command palette."
        : allTodayEvents.length > 0
          ? "All of today's meetings have been handled. Refresh manually to show them again."
          : "No meetings are scheduled for today.";
      container.createDiv({ cls: "wcm-empty", text: message });
      return;
    }

    const list = container.createDiv({ cls: "wcm-event-list" });
    for (const event of events) {
      renderEventRow(list, event, this.controller, this.busyEvents, (selected, action) => {
        void this.runAction(selected, action);
      });
    }
  }

  private async runAction(event: CalendarEvent, action: () => Promise<void>): Promise<void> {
    if (this.busyEvents.has(event.key)) return;
    this.busyEvents.add(event.key);
    this.render();
    try {
      await action();
    } catch (error) {
      reportActionError("sidebar", error);
    } finally {
      this.busyEvents.delete(event.key);
      this.render();
    }
  }
}

export class CalendarEventsModal extends Modal {
  private readonly busyEvents = new Set<string>();
  private opened = false;

  constructor(app: App, private readonly controller: CalendarMeetingsController) {
    super(app);
  }

  onOpen(): void {
    this.opened = true;
    this.setTitle("Today's calendar events");
    this.modalEl.addClass("wcm-calendar-modal");
    this.render();
  }

  onClose(): void {
    this.opened = false;
    this.contentEl.empty();
  }

  render(): void {
    if (!this.opened) return;
    const container = this.contentEl;
    container.empty();

    if (this.controller.isRefreshing()) {
      container.createDiv({ cls: "wcm-refreshing", text: "Refreshing calendars…" });
    }
    const error = this.controller.getLastError();
    if (error) container.createDiv({ cls: "wcm-error", text: error });

    if (!this.controller.getCachedDate()) {
      if (!this.controller.isRefreshing()) {
        container.createDiv({ cls: "wcm-empty", text: "Calendar events are not available yet." });
      }
      return;
    }

    const groups = this.controller.getTodayAndYesterdayEvents();
    this.renderSection(container, "Today", groups.today, "No calendar events today.");
    this.renderSection(container, "Yesterday", groups.yesterday, "No calendar events yesterday.");
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
      renderEventRow(list, event, this.controller, this.busyEvents, (selected, action) => {
        void this.runAction(selected, action);
      });
    }
  }

  private async runAction(event: CalendarEvent, action: () => Promise<void>): Promise<void> {
    if (this.busyEvents.has(event.key)) return;
    this.busyEvents.add(event.key);
    this.render();
    try {
      await action();
    } catch (error) {
      reportActionError("calendar event window", error);
    } finally {
      this.busyEvents.delete(event.key);
      this.render();
    }
  }
}

function renderEventRow(
  list: HTMLElement,
  event: CalendarEvent,
  controller: CalendarMeetingsController,
  busyEvents: ReadonlySet<string>,
  runAction: EventActionRunner,
): void {
  const row = list.createDiv({ cls: "wcm-event" });
  if (busyEvents.has(event.key)) row.addClass("is-busy");

  const title = row.createSpan({ cls: "wcm-event-title", text: event.title });
  title.setAttr("title", event.title);

  const actions = row.createDiv({ cls: "wcm-event-actions" });
  const taskButton = actions.createEl("button", {
    cls: "wcm-action",
    text: "•",
    attr: {
      "aria-label": event.taskAdded ? "Already added to today's tasks" : "Add to today's tasks",
      title: event.taskAdded ? "Already added to today's tasks" : "Add to today's tasks",
      type: "button",
    },
  });
  taskButton.disabled = busyEvents.has(event.key) || event.taskAdded === true;

  const existingMeeting = event.meetingNotePath
    ? controller.app.vault.getAbstractFileByPath(event.meetingNotePath)
    : null;
  const meetingCreated = existingMeeting instanceof TFile;
  const meetingButton = actions.createEl("button", {
    cls: "wcm-action",
    text: "••",
    attr: {
      "aria-label": meetingCreated ? "Meeting note already created" : "Create meeting note",
      title: meetingCreated ? "Meeting note already created" : "Create meeting note",
      type: "button",
    },
  });
  meetingButton.disabled = busyEvents.has(event.key) || meetingCreated;

  taskButton.addEventListener("click", (mouseEvent) => {
    mouseEvent.stopPropagation();
    runAction(event, () => controller.addEventAsTask(event));
  });
  meetingButton.addEventListener("click", (mouseEvent) => {
    mouseEvent.stopPropagation();
    runAction(event, () => controller.createEventMeeting(event));
  });
}

function reportActionError(location: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "The action could not be completed.";
  console.error(`Calendar Meetings: ${location} action failed`, error);
  new Notice(`Calendar Meetings: ${message}`);
}
