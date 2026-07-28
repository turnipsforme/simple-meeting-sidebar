import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type { CalendarEvent } from "./models";

export const CALENDAR_MEETINGS_VIEW = "wrens-calendar-meetings-view";

export interface CalendarMeetingsController {
  getTodayEvents(): CalendarEvent[];
  getCachedDate(): string;
  getLastError(): string;
  addEventAsTask(event: CalendarEvent): Promise<void>;
  createEventMeeting(event: CalendarEvent): Promise<void>;
  app: {
    vault: {
      getAbstractFileByPath(path: string): unknown;
    };
  };
}

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
      const message = this.controller.getCachedDate()
        ? "No meetings are scheduled for today."
        : "Today's calendar has not been refreshed yet. Use “Refresh today's meetings” in the command palette."
      container.createDiv({ cls: "wcm-empty", text: message });
      return;
    }

    const list = container.createDiv({ cls: "wcm-event-list" });
    for (const event of events) this.renderEvent(list, event);
  }

  private renderEvent(list: HTMLElement, event: CalendarEvent): void {
    const row = list.createDiv({ cls: "wcm-event" });
    if (this.busyEvents.has(event.key)) row.addClass("is-busy");

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
    taskButton.disabled = this.busyEvents.has(event.key) || event.taskAdded === true;

    const existingMeeting = event.meetingNotePath
      ? this.controller.app.vault.getAbstractFileByPath(event.meetingNotePath)
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
    meetingButton.disabled = this.busyEvents.has(event.key) || meetingCreated;

    taskButton.addEventListener("click", (mouseEvent) => {
      mouseEvent.stopPropagation();
      void this.runAction(event, () => this.controller.addEventAsTask(event));
    });
    meetingButton.addEventListener("click", (mouseEvent) => {
      mouseEvent.stopPropagation();
      void this.runAction(event, () => this.controller.createEventMeeting(event));
    });
  }

  private async runAction(event: CalendarEvent, action: () => Promise<void>): Promise<void> {
    if (this.busyEvents.has(event.key)) return;
    this.busyEvents.add(event.key);
    this.render();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The action could not be completed.";
      console.error("Calendar Meetings: sidebar action failed", error);
      new Notice(`Calendar Meetings: ${message}`);
    } finally {
      this.busyEvents.delete(event.key);
      this.render();
    }
  }

}
