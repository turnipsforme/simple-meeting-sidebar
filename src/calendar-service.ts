import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { FileSystemAdapter, Plugin } from "obsidian";
import calendarHelperBase64 from "calendar-helper-binary";
import { ensureExecutableHelper } from "./helper-installer";
import type { CalendarEvent } from "./models";
import { replaceControlCharacters } from "./utils";
import { readCalendarEvent } from "./settings-state";

const execFileAsync = promisify(execFile);
const MAX_EVENTS = 10_000;
const MAX_CALENDARS = 1_000;

export class CalendarService {
  private helperReady: Promise<string> | null = null;

  constructor(private readonly plugin: Plugin) {}

  async fetchTodayAndYesterday(): Promise<CalendarEvent[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    const stdout = await this.runHelper([start.toISOString(), end.toISOString()]);

    let decoded: unknown;
    try {
      decoded = JSON.parse(stdout);
    } catch {
      throw new Error("The Apple Calendar helper returned invalid data.");
    }
    if (!Array.isArray(decoded)) throw new Error("The Apple Calendar helper returned an unexpected response.");
    if (decoded.length > MAX_EVENTS) throw new Error("Apple Calendar returned too many events to display safely.");

    const events: CalendarEvent[] = [];
    for (const rawValue of decoded) {
      const event = readCalendarEvent(rawValue, false);
      if (event) events.push(event);
    }

    events.sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      const byStart = Date.parse(left.start) - Date.parse(right.start);
      return byStart || left.title.localeCompare(right.title);
    });
    return events;
  }

  async listCalendars(): Promise<string[]> {
    const stdout = await this.runHelper(["--list-calendars"]);
    let decoded: unknown;
    try {
      decoded = JSON.parse(stdout);
    } catch {
      throw new Error("The Apple Calendar helper returned an invalid calendar list.");
    }
    if (!Array.isArray(decoded) || decoded.length > MAX_CALENDARS) {
      throw new Error("The Apple Calendar helper returned an unexpected calendar list.");
    }

    const calendars = decoded
      .filter((value): value is string => typeof value === "string")
      .map((value) => compactSingleLine(value, 200))
      .filter(Boolean);
    return [...new Set(calendars)].sort((left, right) => left.localeCompare(right));
  }

  private async runHelper(arguments_: string[]): Promise<string> {
    const helperPath = await this.getHelperPath();
    try {
      const result = await execFileAsync(helperPath, arguments_, {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      return result.stdout;
    } catch (error) {
      const details = extractProcessError(error);
      throw new Error(details || "The Apple Calendar helper could not run.");
    }
  }

  private getHelperPath(): Promise<string> {
    this.helperReady ??= this.prepareHelper().catch((error: unknown) => {
      this.helperReady = null;
      throw error;
    });
    return this.helperReady;
  }

  private async prepareHelper(): Promise<string> {
    const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
    if (typeof adapter.getBasePath !== "function") {
      throw new Error("This plugin requires a local macOS vault.");
    }

    const manifestWithDirectory = this.plugin.manifest as typeof this.plugin.manifest & { dir?: string };
    const relativePluginDirectory = manifestWithDirectory.dir
      ?? path.join(this.plugin.app.vault.configDir, "plugins", this.plugin.manifest.id);
    const helperPath = path.join(adapter.getBasePath(), relativePluginDirectory, "bin", "calendar-helper");

    try {
      await ensureExecutableHelper(helperPath, calendarHelperBase64);
      await access(helperPath, fsConstants.X_OK);
    } catch {
      throw new Error("The bundled Apple Calendar helper could not be installed. Reinstall the plugin and check that its folder is writable.");
    }
    return helperPath;
  }
}

function compactSingleLine(value: string, maximumLength: number): string {
  return replaceControlCharacters(value).replace(/\s+/g, " ").trim().slice(0, maximumLength).trim();
}

function extractProcessError(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const processError = error as { stderr?: unknown; message?: unknown; killed?: unknown };
  const stderr = typeof processError.stderr === "string" ? processError.stderr.trim() : "";
  if (stderr) return stderr.split(/\r?\n/).at(-1)?.slice(0, 500) ?? stderr.slice(0, 500);
  if (processError.killed === true) return "Apple Calendar took too long to respond.";
  return typeof processError.message === "string" ? processError.message.slice(0, 500) : "";
}
