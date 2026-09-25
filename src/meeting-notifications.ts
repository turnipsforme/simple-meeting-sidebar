import { Component, MarkdownView, editorInfoField } from "obsidian";
import { EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type SimpleMeetingSidebarPlugin from "./main";
import type { DailyNoteService } from "./daily-note-service";
import type { CalendarEvent } from "./models";
import { notificationField, refreshNotifications } from "./notification-editor";
import { renderEventRow } from "./view";
import { NotificationMotion } from "./notification-motion";

class MeetingWidget extends WidgetType {
  constructor(
    private readonly render: (container: HTMLElement, view: EditorView) => void,
    private readonly dispose: (container: HTMLElement) => void,
  ) { super(); }

  toDOM(view: EditorView): HTMLElement {
    // Obsidian's Node.createDiv() appends immediately; CodeMirror needs a detached node.
    const container = view.dom.ownerDocument.createElement("div");
    this.render(container, view);
    return container;
  }

  updateDOM(container: HTMLElement, view: EditorView): boolean {
    this.render(container, view);
    return true;
  }

  ignoreEvent(): boolean { return true; }

  destroy(container: HTMLElement): void { this.dispose(container); }
}

interface PreviewFooter {
  root: HTMLElement;
  observer: MutationObserver;
  widget: MeetingWidget | null;
  path: string;
}

interface NotificationRow {
  signature: string;
  element: HTMLElement;
}

/** No calendar reads or vault scans: both modes display the existing cached meetings. */
export class MeetingNotifications extends Component {
  readonly extension: Extension;
  private readonly editors = new Set<EditorView>();
  private readonly previews = new Map<HTMLElement, PreviewFooter>();
  private readonly widgets = new Map<string, MeetingWidget>();
  private readonly eventsByPath = new Map<string, CalendarEvent[]>();
  private suppressed = false;
  private suppressionComplete = false;
  private suppressionTimer: number | undefined;
  private signature = "";
  private readonly rows = new WeakMap<HTMLElement, Map<string, NotificationRow>>();
  private readonly motion = new NotificationMotion();

  constructor(private readonly plugin: SimpleMeetingSidebarPlugin, private readonly dailyNotes: DailyNoteService) {
    super();
    const editors = this.editors;
    this.extension = [
      notificationField(
        (state) => state.field(editorInfoField, false)?.file?.path,
        (path) => this.widgets.get(path ?? "") ?? null,
      ),
      ViewPlugin.fromClass(class {
        constructor(readonly view: EditorView) { editors.add(view); }
        destroy(): void { editors.delete(this.view); }
      }),
    ];
  }

  onload(): void {
    const workspace = this.plugin.app.workspace;
    this.registerEvent(workspace.on("layout-change", () => this.refresh()));
    this.registerEvent(workspace.on("file-open", () => this.refresh()));
    this.register(this.plugin.subscribe(() => this.refresh()));
    this.refresh();

  }

  onunload(): void {
    window.clearTimeout(this.suppressionTimer);
    this.motion.destroy();
    for (const footer of this.previews.values()) this.removePreview(footer);
    this.previews.clear();
  }

  prepareDismissal(key: string): void { this.motion.prepareDismissal(key); }

  private refresh(): void {
    const suppressed = this.plugin.shouldHideInlineNotifications();
    if (suppressed !== this.suppressed) {
      window.clearTimeout(this.suppressionTimer);
      this.suppressed = suppressed;
      this.suppressionComplete = false;
      if (suppressed) this.suppressionTimer = window.setTimeout(() => {
        this.suppressionComplete = true;
        this.refresh();
      }, 200);
    }
    const days = [new Date(), new Date()];
    days[1]!.setDate(days[0]!.getDate() + 1);
    const groups = days.map((date) => ({
      date, path: this.dailyNotes.getPathForDate(date),
      events: this.suppressionComplete ? [] : this.plugin.getNotificationEvents(date)
        .filter((event) => !event.notificationHidden && !event.sidebarHidden),
    }));
    const signature = JSON.stringify([this.suppressed, this.plugin.settings.monochromeNotifications,
      groups.map(({path, events}) => ({path, events})), groups.map(({ events }) => events.map((event) => this.plugin.isEventBusy(event.key)))]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.widgets.clear();
      this.eventsByPath.clear();
      for (const { path, events, date } of groups) {
        if (!events.length) continue;
        this.eventsByPath.set(path, events);
        this.widgets.set(path, new MeetingWidget(
          (container, view) => this.render(container, events, date, view),
          (container) => this.motion.remove(container),
        ));
      }
      for (const editor of this.editors) editor.dispatch({ effects: refreshNotifications.of(null) });
    }
    this.refreshPreviews();
  }

  private render(container: HTMLElement, events: CalendarEvent[], date: Date, editor?: EditorView): void {
    // A widget can be redrawn while persistence is in flight, before refresh()
    // replaces its captured event list. Never resurrect a newly hidden event.
    const availableEvents = events.filter((event) => !event.notificationHidden && !event.sidebarHidden);
    const previous = this.rows.get(container) ?? new Map<string, NotificationRow>();
    const candidates = availableEvents.slice(0, 3);
    // Fill the vacated slot instead of shifting the other two banners on each action.
    const queued = candidates.filter((event) => !previous.has(event.key));
    const visibleEvents: CalendarEvent[] = [];
    for (const key of previous.keys()) {
      const surviving = candidates.find((event) => event.key === key);
      const event = surviving ?? queued.shift();
      if (event) visibleEvents.push(event);
    }
    visibleEvents.push(...queued);
    container.className = "wcm-notifications";
    container.classList.toggle("wcm-notifications-suppressed", this.suppressed);
    container.inert = this.suppressed;
    container.setAttribute("aria-hidden", String(this.suppressed));
    container.classList.toggle("wcm-notifications-monochrome", this.plugin.settings.monochromeNotifications);
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Inline meetings");
    const next = new Map<string, NotificationRow>();
    const eventKeys = new Set(visibleEvents.map((event) => event.key));
    // Remove first so surviving rows don't need to be reinserted around a gap.
    for (const [key, row] of previous) {
      row.element.classList.remove("wcm-notification-enter");
      if (!eventKeys.has(key)) row.element.remove();
    }
    let position: ChildNode | null = container.firstChild;
    for (const event of visibleEvents) {
      const signature = JSON.stringify([event, this.plugin.isEventBusy(event.key),
        date.toDateString() === new Date().toDateString()]);
      const old = previous.get(event.key);
      let element = old?.element;
      // A busy-state render must not replace the row whose exit is still visible
      // (or holding its final frame while the dismissal saves).
      if (!old || (old.signature !== signature && !old.element.classList.contains("is-dismissing"))) {
        // Keep staging detached; Obsidian's Node helpers append to their receiver.
        const holder = container.ownerDocument.createElement("div");
        renderEventRow(holder, event, this.plugin, "notification", date);
        element = holder.firstElementChild as HTMLElement;
        if (!old) element.classList.add("wcm-notification-enter");
        if (old) {
          const focused = old.element.contains(container.ownerDocument.activeElement)
            ? container.ownerDocument.activeElement?.getAttribute("aria-label") : null;
          if (position === old.element) position = element;
          old.element.replaceWith(element);
          if (focused) {
            Array.from(element.querySelectorAll("button"))
              .find((button) => button.getAttribute("aria-label") === focused && !button.disabled)
              ?.focus({ preventScroll: true });
          }
        }
      }
      if (!element) continue;
      if (element !== position) container.insertBefore(element, position);
      position = element.nextSibling;
      next.set(event.key, { signature, element });
    }
    let more = container.querySelector<HTMLElement>(":scope > .wcm-notifications-more");
    const remaining = availableEvents.length - visibleEvents.length;
    if (remaining > 0) {
      if (!more) more = container.createDiv({ cls: "wcm-notifications-more" });
      more.textContent = `+ ${remaining} more`;
      container.appendChild(more);
    } else more?.remove();
    this.rows.set(container, next);
    this.motion.update(container, new Map([...next].map(([key, row]) => [key, row.element])), editor);
  }

  private refreshPreviews(): void {
    const active = new Set<HTMLElement>();
    if (this.widgets.size) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file || !this.widgets.has(view.file.path) || view.getMode() !== "preview") continue;
        const preview = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
        if (!preview) continue;
        active.add(preview);
        let footer = this.previews.get(preview);
        if (!footer) {
          // Keep the footer detached until placePreview chooses its position.
          const root = preview.ownerDocument.createElement("div");
          const observer = new (preview.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver(() => {
            if (this.previews.has(preview)) this.placePreview(preview);
          });
          footer = { root, observer, widget: null, path: view.file.path };
          this.previews.set(preview, footer);
          // Observe only daily-note reading panes that have upcoming meetings.
          observer.observe(preview, { childList: true, subtree: true });
        }
        footer.path = view.file.path;
        this.placePreview(preview);
      }
    }
    for (const [preview, footer] of this.previews) {
      if (active.has(preview)) continue;
      this.removePreview(footer);
      this.previews.delete(preview);
    }
  }

  private placePreview(preview: HTMLElement): void {
    const footer = this.previews.get(preview);
    if (!footer) return;
    const widget = this.widgets.get(footer.path);
    if (!widget) return;
    if (footer.widget !== widget) {
      // The same renderer is used in reading mode and the editor widget.
      const events = this.eventsByPath.get(footer.path) ?? [];
      const date = new Date();
      if (footer.path !== this.dailyNotes.getTodayPath()) date.setDate(date.getDate() + 1);
      this.render(footer.root, events, date);
      footer.widget = widget;
    }
    const influx = preview.querySelector<HTMLElement>(":scope > .influx-preview-wrapper");
    const sizer = preview.querySelector<HTMLElement>(":scope > .markdown-preview-sizer");
    // Respect Influx's optional top-of-page layout: only precede its footer.
    const influxAtBottom = influx && (!sizer || Boolean(sizer.compareDocumentPosition(influx) & 4));
    const before = influxAtBottom ? influx : preview.querySelector<HTMLElement>(":scope > .embedded-backlinks");
    if (footer.root.parentElement !== preview || footer.root.nextSibling !== before) {
      preview.insertBefore(footer.root, before);
    }
    preview.classList.add("wcm-has-notifications");
  }

  private removePreview(footer: PreviewFooter): void {
    this.motion.remove(footer.root);
    footer.observer.disconnect();
    footer.root.parentElement?.classList.remove("wcm-has-notifications");
    footer.root.remove();
  }
}
