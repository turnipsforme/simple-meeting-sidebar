import { moment, normalizePath, type App, TFile, TFolder } from "obsidian";
import {
  formatDailyNoteLinkLabel,
  insertMeetingLinkIntoDailyNote,
  insertTaskIntoDailyNote,
} from "./utils";

interface DailyNoteSettings {
  format: string;
  folder: string;
  template: string;
}

interface ObsidianInternals extends App {
  internalPlugins?: {
    getPluginById(id: string): {
      enabled?: boolean;
      instance?: {
        options?: Partial<DailyNoteSettings>;
        createDailyNote?(date: moment.Moment): Promise<TFile | null | undefined>;
      };
    } | null;
  };
  plugins?: {
    getPlugin(id: string): {
      settings?: {
        daily?: Partial<DailyNoteSettings> & { enabled?: boolean };
      };
      createDailyNote?(date: moment.Moment): Promise<TFile | null | undefined>;
    } | null;
  };
}

const DEFAULT_DAILY_SETTINGS: DailyNoteSettings = {
  format: "YYYY-MM-DD",
  folder: "",
  template: "",
};

export class DailyNoteService {
  constructor(private readonly app: App) {}

  async getOrCreateToday(): Promise<TFile> {
    const date = moment();
    const settings = this.getSettings();
    const path = this.buildPath(date.format(settings.format), settings.folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    const nativeCreated = await this.tryNativeCreation(date);
    if (nativeCreated instanceof TFile) return nativeCreated;

    await this.ensureFolder(settings.folder);
    const template = await this.renderTemplate(date, settings);
    try {
      return await this.app.vault.create(path, template);
    } catch (error) {
      // A simultaneous command or another plugin may have created it first.
      const racedFile = this.app.vault.getAbstractFileByPath(path);
      if (racedFile instanceof TFile) return racedFile;
      throw error;
    }
  }

  async addTask(file: TFile, eventTitle: string): Promise<boolean> {
    let changed = false;
    await this.app.vault.process(file, (content) => {
      const update = insertTaskIntoDailyNote(content, eventTitle);
      changed = update.changed;
      return update.content;
    });
    return changed;
  }

  async addMeetingReference(file: TFile, markdownLink: string): Promise<boolean> {
    let changed = false;
    await this.app.vault.process(file, (content) => {
      const update = insertMeetingLinkIntoDailyNote(content, markdownLink);
      changed = update.changed;
      return update.content;
    });
    return changed;
  }

  getLinkLabel(file: TFile): string {
    const settings = this.getSettings();
    const folder = normalizePath(settings.folder.trim());
    const withoutExtension = file.path.replace(/\.md$/i, "");
    const dateText = folder && withoutExtension.startsWith(`${folder}/`)
      ? withoutExtension.slice(folder.length + 1)
      : file.basename;
    const parsed = moment(dateText, settings.format, true);
    return formatDailyNoteLinkLabel((parsed.isValid() ? parsed : moment()).toDate());
  }

  private getSettings(): DailyNoteSettings {
    const app = this.app as ObsidianInternals;
    const periodicDaily = app.plugins?.getPlugin("periodic-notes")?.settings?.daily;
    if (periodicDaily?.enabled) {
      return {
        format: periodicDaily.format || DEFAULT_DAILY_SETTINGS.format,
        folder: periodicDaily.folder?.trim() || "",
        template: periodicDaily.template?.trim() || "",
      };
    }

    const coreOptions = app.internalPlugins?.getPluginById("daily-notes")?.instance?.options;
    return {
      format: coreOptions?.format || DEFAULT_DAILY_SETTINGS.format,
      folder: coreOptions?.folder?.trim() || "",
      template: coreOptions?.template?.trim() || "",
    };
  }

  private async tryNativeCreation(date: moment.Moment): Promise<TFile | null> {
    const app = this.app as ObsidianInternals;
    const periodic = app.plugins?.getPlugin("periodic-notes");
    if (periodic?.settings?.daily?.enabled && periodic.createDailyNote) {
      try {
        return (await periodic.createDailyNote(date.clone())) ?? null;
      } catch (error) {
        console.warn("Calendar Meetings: Periodic Notes could not create today's note", error);
      }
    }

    const core = app.internalPlugins?.getPluginById("daily-notes");
    if (core?.enabled && core.instance?.createDailyNote) {
      try {
        return (await core.instance.createDailyNote(date.clone())) ?? null;
      } catch (error) {
        console.warn("Calendar Meetings: Daily Notes could not create today's note", error);
      }
    }
    return null;
  }

  private async renderTemplate(date: moment.Moment, settings: DailyNoteSettings): Promise<string> {
    if (!settings.template) return "";
    const templateFile = this.findTemplate(settings.template);
    if (!templateFile) return "";
    const raw = await this.app.vault.cachedRead(templateFile);
    const now = moment();
    const filename = date.format(settings.format);

    return raw
      .replace(/{{\s*date\s*}}/gi, filename)
      .replace(/{{\s*time\s*}}/gi, now.format("HH:mm"))
      .replace(/{{\s*title\s*}}/gi, filename)
      .replace(/{{\s*yesterday\s*}}/gi, date.clone().subtract(1, "day").format(settings.format))
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "day").format(settings.format));
  }

  private findTemplate(template: string): TFile | null {
    const linked = this.app.metadataCache.getFirstLinkpathDest(template, "");
    if (linked instanceof TFile) return linked;
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(template));
    if (direct instanceof TFile) return direct;
    const withExtension = this.app.vault.getAbstractFileByPath(normalizePath(`${template}.md`));
    return withExtension instanceof TFile ? withExtension : null;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath.trim());
    if (!normalized || normalized === "/") return;
    let current = "";
    for (const part of normalized.split("/")) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`A file already exists where the folder ${current} is needed.`);
      await this.app.vault.createFolder(current);
    }
  }

  private buildPath(filename: string, folder: string): string {
    return normalizePath(folder.trim() ? `${folder.trim()}/${filename}.md` : `${filename}.md`);
  }
}
