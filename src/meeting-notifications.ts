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

  destroy(container: HTMLElement): void { this.dispose(container); }
}

interface PreviewFooter {
  root: HTMLElement;
  observer: MutationObserver;
  widget: MeetingWidget | null;
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
  private todayPath = "";
  private signature = "";
  private widget: MeetingWidget | null = null;
  private readonly rows = new WeakMap<HTMLElement, Map<string, NotificationRow>>();
  private readonly motion = new NotificationMotion();

  constructor(private readonly plugin: SimpleMeetingSidebarPlugin, private readonly dailyNotes: DailyNoteService) {
    super();
    const editors = this.editors;
    this.extension = [
      notificationField(
        (state) => state.field(editorInfoField, false)?.file?.path,
        (path) => path === this.todayPath ? this.widget : null,
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
    this.motion.destroy();
    for (const footer of this.previews.values()) this.removePreview(footer);
    this.previews.clear();
  }

  prepareDismissal(key: string): void { this.motion.prepareDismissal(key); }

  private refresh(): void {
    const events = this.plugin.getNotificationEvents().filter((event) => !event.notificationHidden);
    const todayPath = this.dailyNotes.getTodayPath();
    const signature = JSON.stringify([todayPath, this.plugin.settings.monochromeNotifications,
      events, events.map((event) => this.plugin.isEventBusy(event.key))]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.todayPath = todayPath;
      this.widget = events.length ? new MeetingWidget(
        (container, view) => this.render(container, events, view),
        (container) => this.motion.remove(container),
      ) : null;
      for (const editor of this.editors) editor.dispatch({ effects: refreshNotifications.of(null) });
    }
    this.refreshPreviews();
  }

  private render(container: HTMLElement, events: CalendarEvent[], editor?: EditorView): void {
    // A widget can be redrawn while persistence is in flight, before refresh()
    // replaces its captured event list. Never resurrect a newly hidden event.
    const visibleEvents = events.filter((event) => !event.notificationHidden && !event.sidebarHidden);
    container.className = "wcm-notifications";
    container.classList.toggle("wcm-notifications-monochrome", this.plugin.settings.monochromeNotifications);
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Meeting notifications");
    const previous = this.rows.get(container) ?? new Map<string, NotificationRow>();
    const next = new Map<string, NotificationRow>();
    const eventKeys = new Set(visibleEvents.map((event) => event.key));
    // Remove first so surviving rows don't need to be reinserted around a gap.
    for (const [key, row] of previous) {
      row.element.classList.remove("wcm-notification-enter");
      if (!eventKeys.has(key)) row.element.remove();
    }
    let position: ChildNode | null = container.firstChild;
    for (const event of visibleEvents) {
      const signature = JSON.stringify([event, this.plugin.isEventBusy(event.key)]);
      const old = previous.get(event.key);
      let element = old?.element;
      // A busy-state render must not replace the row whose exit is still visible
      // (or holding its final frame while the dismissal saves).
      if (!old || (old.signature !== signature && !old.element.classList.contains("is-dismissing"))) {
        // Keep staging detached; Obsidian's Node helpers append to their receiver.
        const holder = container.ownerDocument.createElement("div");
        renderEventRow(holder, event, this.plugin, "notification");
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
    this.rows.set(container, next);
    this.motion.update(container, new Map([...next].map(([key, row]) => [key, row.element])), editor);
  }

  private refreshPreviews(): void {
    const active = new Set<HTMLElement>();
    if (this.widget) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || view.file?.path !== this.todayPath || view.getMode() !== "preview") continue;
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
          footer = { root, observer, widget: null };
          this.previews.set(preview, footer);
          // Observe only reading panes for today's note, and only while they have meetings.
          observer.observe(preview, { childList: true, subtree: true });
        }
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
    if (!footer || !this.widget) return;
    if (footer.widget !== this.widget) {
      // The same renderer is used in reading mode and the editor widget.
      const events = this.plugin.getNotificationEvents().filter((event) => !event.notificationHidden);
      this.render(footer.root, events);
      footer.widget = this.widget;
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
