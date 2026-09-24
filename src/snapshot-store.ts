import { TFile, type App } from "obsidian";
import { ensureVaultFolder } from "./daily-note-service";
import { MAX_SNAPSHOT_BYTES, parseSnapshot, SNAPSHOT_PATH, type CalendarSnapshot } from "./calendar-snapshot";

/** Vault-only I/O. Never imports the helper, Node, or a filesystem adapter. */
export class SnapshotStore {
  constructor(private readonly app: App) {}

  async read(): Promise<CalendarSnapshot> {
    const file = this.app.vault.getAbstractFileByPath(SNAPSHOT_PATH);
    if (!(file instanceof TFile) || file.stat.size > MAX_SNAPSHOT_BYTES) throw new Error("Waiting for calendar sync.");
    // cachedRead may still hold the previous file while Sync is replacing it.
    return parseSnapshot(await this.app.vault.read(file));
  }

  async publish(snapshot: CalendarSnapshot): Promise<void> {
    const content = JSON.stringify(snapshot);
    await ensureVaultFolder(this.app, SNAPSHOT_PATH.slice(0, SNAPSHOT_PATH.lastIndexOf("/")));
    let file = this.app.vault.getAbstractFileByPath(SNAPSHOT_PATH);
    if (!file) {
      try {
        await this.app.vault.create(SNAPSHOT_PATH, content);
        return;
      } catch (error) {
        file = this.app.vault.getAbstractFileByPath(SNAPSHOT_PATH);
        if (!(file instanceof TFile)) throw error;
      }
    }
    if (!(file instanceof TFile)) throw new Error("Calendar snapshot path is a folder.");
    await this.app.vault.process(file, (current) => {
      // Atomic on this device. Remote sync still needs the reader's high-water check.
      try {
        if (parseSnapshot(current).generatedAt >= snapshot.generatedAt) return current;
      } catch { /* A successful calendar read can repair an invalid synced file. */ }
      return content;
    });
  }
}
