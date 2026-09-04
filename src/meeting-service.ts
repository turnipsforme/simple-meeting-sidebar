import { normalizePath, type App, TFile, TFolder } from "obsidian";
import type { CalendarEvent } from "./models";
import { DailyNoteService } from "./daily-note-service";
import { PeopleIndex } from "./people-index";
import { nextMeetingBasename, normalizeVaultFolder, sanitizeMeetingTitle } from "./utils";

export interface MeetingCreationResult {
  file: TFile;
  warning?: string;
}

export class MeetingService {
  constructor(
    private readonly app: App,
    private readonly dailyNotes: DailyNoteService,
    private readonly people: PeopleIndex,
    private getMeetingFolder: () => string,
    private shouldAddMeetingToDailyNote: () => boolean,
  ) {}

  async addTask(event: CalendarEvent): Promise<boolean> {
    const dailyNote = await this.dailyNotes.getOrCreateToday();
    return this.dailyNotes.addTask(dailyNote, event.title);
  }

  async createMeeting(event: CalendarEvent): Promise<MeetingCreationResult> {
    const dailyNote = await this.dailyNotes.getOrCreateToday();
    const folder = normalizeVaultFolder(this.getMeetingFolder(), "Meetings");
    await this.ensureFolder(folder);

    const baseName = sanitizeMeetingTitle(event.title);
    let basenames = this.getExistingMeetingBasenames(folder);
    const person = this.people.find(event.title, event.guests);
    let meetingFile: TFile | null = null;

    // Retrying makes simultaneous button presses collision-safe without ever overwriting.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const noteName = nextMeetingBasename(baseName, basenames);
      const notePath = normalizePath(`${folder}/${noteName}.md`);
      const personLink = person
        ? this.app.fileManager.generateMarkdownLink(person.file, notePath, undefined, person.displayText)
        : "";
      const dailyNoteLink = this.app.fileManager.generateMarkdownLink(
        dailyNote,
        notePath,
        undefined,
        this.dailyNotes.getLinkLabel(dailyNote),
      );
      const content = this.renderTemplate(noteName, personLink, dailyNoteLink);

      try {
        meetingFile = await this.app.vault.create(notePath, content);
        break;
      } catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(notePath) instanceof TFile)) throw error;
        basenames = [...basenames, noteName];
      }
    }
    if (!meetingFile) throw new Error("Could not find an unused meeting note name.");

    let warning: string | undefined;
    if (this.shouldAddMeetingToDailyNote()) {
      try {
        const meetingLink = this.app.fileManager.generateMarkdownLink(
          meetingFile,
          dailyNote.path,
          undefined,
          meetingFile.basename,
        );
        await this.dailyNotes.addMeetingReference(dailyNote, meetingLink);
      } catch (error) {
        console.error("Simple Meeting Sidebar: meeting created, but daily note link failed", error);
        warning = "The meeting note was created, but its link could not be added to today's daily note.";
      }
    }

    await this.app.workspace.getLeaf(false).openFile(meetingFile);
    return warning ? { file: meetingFile, warning } : { file: meetingFile };
  }

  private renderTemplate(noteName: string, personLink: string, dailyNoteLink: string): string {
    return `# ${noteName}\n\n#Meeting with ${personLink} on ${dailyNoteLink}\n\n- \n`;
  }

  private getExistingMeetingBasenames(folder: string): string[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.parent?.path === folder)
      .map((file) => file.basename);
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    let current = "";
    for (const part of folderPath.split("/")) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`A file already exists where the folder ${current} is needed.`);
      await this.app.vault.createFolder(current);
    }
  }
}
