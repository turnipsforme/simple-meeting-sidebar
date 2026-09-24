import { TFile, TFolder, type App } from "obsidian";
import { ensureVaultFolder } from "./daily-note-service";
import { eventIdentity } from "./event-identity";
import type { CalendarEvent } from "./models";

export const DISMISSALS_PATH = "Meetings/_calendar/dismissals";
type DismissalKind = "notification" | "sidebar";

/** Immutable records keep simultaneous offline dismissals from overwriting each other. */
export class DismissalStore {
  private readonly notifications = new Set<string>();
  private readonly sidebar = new Set<string>();
  constructor(private readonly app: App) {}

  async load(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(DISMISSALS_PATH);
    if (folder instanceof TFolder) {
      for (const file of folder.children) await this.read(file.path);
    }
  }

  async read(path: string): Promise<void> {
    if (!path.startsWith(`${DISMISSALS_PATH}/`) || !path.endsWith(".json")) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.stat.size > 16_384) return;
    try {
      const raw = JSON.parse(await this.app.vault.read(file)) as Record<string, unknown>;
      if (raw.version !== 1 || typeof raw.identity !== "string" || raw.identity.length > 12_000) return;
      if (raw.kind === "notification") this.notifications.add(raw.identity);
      if (raw.kind === "sidebar") this.sidebar.add(raw.identity);
    } catch { /* A sync write may not have finished; the next modify event retries it. */ }
  }

  apply(events: CalendarEvent[]): void {
    for (const event of events) {
      const identity = eventIdentity(event);
      if (this.notifications.has(identity)) event.notificationHidden = true;
      if (this.sidebar.has(identity)) event.sidebarHidden = true;
    }
  }

  async dismiss(event: CalendarEvent, kind: DismissalKind): Promise<void> {
    const identity = eventIdentity(event);
    (kind === "sidebar" ? this.sidebar : this.notifications).add(identity);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const path = `${DISMISSALS_PATH}/${hash}-${kind}.json`;
    await ensureVaultFolder(this.app, DISMISSALS_PATH);
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return;
    try {
      await this.app.vault.create(path, JSON.stringify({ version: 1, identity, kind }));
    } catch (error) {
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw error;
    }
  }
}
