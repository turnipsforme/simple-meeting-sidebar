import { normalizePath, FuzzySuggestModal, type App, TFile } from "obsidian";
import { eventIdentity, eventTaskMarker } from "./event-identity";
import type { CalendarEvent } from "./models";
import { DailyNoteService, ensureVaultFolder } from "./daily-note-service";
import { PeopleIndex } from "./people-index";
import { meetingTaskTitle, nextMeetingBasename, normalizeVaultFolder, sanitizeMeetingTitle } from "./utils";

export interface MeetingCreationResult {
  file: TFile;
  warning?: string;
}

export class MeetingService {
  private readonly creations = new Map<string, Promise<MeetingCreationResult | null>>();
  constructor(
    private readonly app: App,
    private readonly dailyNotes: DailyNoteService,
    private readonly people: PeopleIndex,
    private getMeetingFolder: () => string,
    private shouldAddMeetingToDailyNote: () => boolean,
    private shouldIncludeTime: () => boolean = () => false,
  ) {}

  async addTask(event: CalendarEvent): Promise<boolean> {
    if (event.taskAdded) return false;
    const dailyNote = await this.dailyNotes.getOrCreateToday();
    return this.dailyNotes.addTask(dailyNote, meetingTaskTitle(event, this.shouldIncludeTime()), eventTaskMarker(event));
  }

  createMeeting(event: CalendarEvent): Promise<MeetingCreationResult | null> {
    const identity = eventIdentity(event);
    const existing = this.creations.get(identity);
    if (existing) return existing;
    const operation = this.performCreateMeeting(event, identity).finally(() => this.creations.delete(identity));
    this.creations.set(identity, operation);
    return operation;
  }

  private async performCreateMeeting(event: CalendarEvent, identity: string): Promise<MeetingCreationResult | null> {
    const matches = await this.findExisting(identity);
    if (matches.length) {
      const existing = matches.length === 1 ? matches[0]! : await new ExistingMeetingModal(this.app, matches).choose();
      if (!existing) return null;
      await this.app.workspace.getLeaf(false).openFile(existing);
      return { file: existing };
    }
    const dailyNote = await this.dailyNotes.getOrCreateToday();
    const folder = normalizeVaultFolder(this.getMeetingFolder(), "Meetings");
    await ensureVaultFolder(this.app, folder);

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
      const content = `---\nsimple-meeting-event: ${JSON.stringify(identity)}\n---\n\n` + this.renderTemplate(noteName, personLink, dailyNoteLink);

      try {
        meetingFile = await this.app.vault.create(notePath, content);
        break;
      } catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(notePath) instanceof TFile)) throw error;
        const raced = this.app.vault.getAbstractFileByPath(notePath);
        if (raced instanceof TFile && (await this.app.vault.read(raced)).includes(`simple-meeting-event: ${JSON.stringify(identity)}`)) {
          meetingFile = raced;
          break;
        }
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

  private async findExisting(identity: string): Promise<TFile[]> {
    const matches: TFile[] = [];
    // Only a user action scans metadata. No vault scanning during rendering or sync.
    const folder = normalizeVaultFolder(this.getMeetingFolder(), "Meetings");
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.["simple-meeting-event"] === identity) matches.push(file);
      else if (!cache && file.parent?.path === folder) {
        // Newly synced notes may arrive before their metadata. Read only those files.
        if ((await this.app.vault.read(file)).startsWith(`---\nsimple-meeting-event: ${JSON.stringify(identity)}\n`)) matches.push(file);
      }
    }
    return matches;
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

}

/** Offline duplicates are kept intact; the user chooses which synced note to use. */
class ExistingMeetingModal extends FuzzySuggestModal<TFile> {
  private resolve: ((file: TFile | null) => void) | undefined;
  private selected = false;
  constructor(app: App, private readonly files: TFile[]) {
    super(app);
    this.setPlaceholder("Multiple notes exist for this meeting. Choose one to open.");
  }
  getItems(): TFile[] { return this.files; }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.selected = true; this.resolve?.(file); }
  onClose(): void { window.setTimeout(() => { if (!this.selected) this.resolve?.(null); }, 0); }
  choose(): Promise<TFile | null> {
    return new Promise((resolve) => { this.resolve = resolve; this.open(); });
  }
}
