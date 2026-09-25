import { Platform, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type SimpleMeetingSidebarPlugin from "./main";
import type { RefreshSchedule } from "./models";
import { normalizeVaultFolder, parseDailyTime } from "./utils";

export class SimpleMeetingSidebarSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly calendarPlugin: SimpleMeetingSidebarPlugin) {
    super(app, calendarPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: "Simple Meeting Sidebar settings",
      // This is a rendering wrapper, not a second searchable settings page.
      searchable: false,
      aliases: ["events", "calendars", "meetings", "people", "refresh", "Advanced URI"],
      render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("wcm-settings-content");
        this.renderSettings(setting.settingEl);
      },
    }];
  }

  display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    containerEl.empty();
    const reader = this.calendarPlugin.isSnapshotReader();
    if (Platform.isMobile) containerEl.createEl("p", {
      cls: "setting-item-description",
      // Keep the literal vault path and the Obsidian Sync setting name accurate.
      text: "Meetings load from Meetings/_calendar/events.json. Refresh on your Mac and enable Sync all other types on both devices. Banners appear only while the snapshot is less than one hour old; saved meetings remain available in the sidebar.",
    });
    new Setting(containerEl).setName("Events").setHeading();
    containerEl.createEl("p", {
      text: reader ? "Calendar selection syncs with your Macs. Only calendars in the received snapshot are listed here." : "Choose which Apple calendars contribute events. All calendars are used until you turn one off.",
      cls: "setting-item-description",
    });
    const calendarChoices = containerEl.createDiv();
    calendarChoices.createDiv({ cls: "setting-item-description", text: "Loading calendars…" });
    void this.displayCalendarChoices(calendarChoices);

    new Setting(containerEl)
      .setName("Only events with meeting links")
      .setDesc("Include events with Google Meet, Zoom, or Microsoft Teams links in the event URL, location, or notes.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.onlyMeetingLinkEvents)
        .onChange(async (value) => {
          this.calendarPlugin.settings.onlyMeetingLinkEvents = value;
          await this.calendarPlugin.saveSettings();
          this.calendarPlugin.renderViews();
          if (value) void this.calendarPlugin.refreshToday(false).catch(() => undefined);
        }));

    for (const [key, name, description] of [
      ["ignoreAllDayEvents", "Ignore all day events", "Hide all-day events from the sidebar and inline meetings. On by default."],
      ["ignoreRepeatingEvents", "Ignore repeating events", "Hide recurring events from the sidebar and inline meetings. Refresh on your Mac after upgrading to identify repeats."],
    ] as const) {
      new Setting(containerEl).setName(name).setDesc(description)
        .addToggle((toggle) => toggle.setValue(this.calendarPlugin.settings[key]).onChange(async (value) => {
          this.calendarPlugin.settings[key] = value;
          this.calendarPlugin.renderViews();
          await this.calendarPlugin.saveSettings();
        }));
    }

    new Setting(containerEl)
      .setName("Inline meetings")
      .setDesc("Show up to three upcoming meetings above linked mentions. Tomorrow’s meetings appear in tomorrow’s note after 5pm. Banners disappear at the meeting start time. Dismissals sync between devices.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.meetingNotifications)
        .onChange(async (value) => {
          this.calendarPlugin.settings.meetingNotifications = value;
          this.calendarPlugin.configureNotifications();
          await this.calendarPlugin.saveSettings();
        }));

    if (!Platform.isMobile) new Setting(containerEl)
      .setName("Only show inline meetings when the right sidebar is hidden")
      .setDesc("Fade inline banners out when the right sidebar opens, and back in when it closes. Dismissed meetings stay hidden.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.notificationsOnlyWhenSidebarHidden)
        .onChange(async (value) => {
          this.calendarPlugin.settings.notificationsOnlyWhenSidebarHidden = value;
          this.calendarPlugin.renderViews();
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Neutral inline meetings")
      .setDesc("Use your theme's neutral background, text, and borders. On by default; turn off for blue banners.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.monochromeNotifications)
        .onChange(async (value) => {
          this.calendarPlugin.settings.monochromeNotifications = value;
          this.calendarPlugin.renderViews();
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Include meeting time in tasks")
      .setDesc("Prefix new tasks with the meeting time, for example “10:30am weekly catch-up”. All-day events always use just the event title.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.includeMeetingTimeInTask)
        .onChange(async (value) => {
          this.calendarPlugin.settings.includeMeetingTimeInTask = value;
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Meetings folder")
      .setDesc("Meeting notes are created here. The default folder name is shown below.")
      .addText((text) => text
        .setPlaceholder("Meetings")
        .setValue(this.calendarPlugin.settings.meetingsFolder)
        .onChange(async (value) => {
          this.calendarPlugin.settings.meetingsFolder = normalizeVaultFolder(value, "Meetings");
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Add meeting notes to daily note")
      .setDesc("When turned off, creating a meeting note does not add a reference to today's daily note. The meeting note still links back to it.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.addMeetingNotesToDailyNote)
        .onChange(async (value) => {
          this.calendarPlugin.settings.addMeetingNotesToDailyNote = value;
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("People folder")
      .setDesc("Only notes in this folder tagged #Person are considered for person matching.")
      .addText((text) => text
        .setPlaceholder("People")
        .setValue(this.calendarPlugin.settings.peopleFolder)
        .onChange(async (value) => {
          this.calendarPlugin.settings.peopleFolder = normalizeVaultFolder(value, "People");
          this.calendarPlugin.peopleIndex.invalidate();
          await this.calendarPlugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Consider person aliases")
      .setDesc("Match aliases from a #Person note's alias or aliases property as well as its note title.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.considerAliases)
        .onChange(async (value) => {
          this.calendarPlugin.settings.considerAliases = value;
          this.calendarPlugin.peopleIndex.invalidate();
          await this.calendarPlugin.saveSettings();
        }));

    const ignoredPeopleSetting = new Setting(containerEl)
      .setName("Ignored people")
      .setDesc("People who should never be linked in meeting notes, matched against event guests by first or full name. Comma separated; capitalization doesn't matter.")
      .addText((text) => text
        .setPlaceholder("E.g. Mish, Wren, Dana Smith")
        .setValue(this.calendarPlugin.settings.ignoredPeople)
        .onChange(async (value) => {
          this.calendarPlugin.settings.ignoredPeople = value;
          this.calendarPlugin.peopleIndex.invalidate();
          await this.calendarPlugin.saveSettings();
        }));
    ignoredPeopleSetting.settingEl.addClass("wcm-people-setting");

    if (!reader) new Setting(containerEl)
      .setName("Calendar refresh schedule")
      .setDesc("Checks regularly while Obsidian is open and catches up after a missed refresh. Manual never runs by itself.")
      .addDropdown((dropdown) => dropdown
        .addOption("manual", "Manual")
        .addOption("60", "Every hour")
        .addOption("360", "Every 6 hours")
        .addOption("720", "Every 12 hours")
        .addOption("daily", "Once a day")
        .addOption("weekly", "Once a week")
        .setValue(this.calendarPlugin.settings.refreshSchedule)
        .onChange(async (value) => {
          this.calendarPlugin.settings.refreshSchedule = value as RefreshSchedule;
          await this.calendarPlugin.saveSettings();
          this.calendarPlugin.configureSchedule();
        }));

    if (!reader) new Setting(containerEl)
      .setName("Daily refresh time")
      .setDesc("Local Mac time used by the once-a-day schedule. Defaults to 08:00.")
      .addText((text) => text
        .setPlaceholder("08:00")
        .setValue(this.calendarPlugin.settings.dailyRefreshTime)
        .onChange(async (value) => {
          if (!parseDailyTime(value)) return;
          this.calendarPlugin.settings.dailyRefreshTime = value;
          await this.calendarPlugin.saveSettings();
          this.calendarPlugin.configureSchedule();
        }));

    new Setting(containerEl)
      .setName(reader ? "Reload synced meetings" : "Refresh now")
      .setDesc(reader ? "Reads the latest snapshot received on this device. It does not request new calendar data from your Mac." : "Refreshes yesterday, today and the next seven days, and updates synced meetings.")
      .addButton((button) => button
        .setButtonText(reader ? "Reload" : "Refresh")
        .onClick(async (event) => {
          button.setDisabled(true);
          try {
            await this.calendarPlugin.refreshToday(true, event.detail > 0);
          } catch {
            // refreshToday already reports the specific helper or permission error.
          } finally {
            button.setDisabled(false);
          }
        }));

    new Setting(containerEl).setName("Advanced URI integration").setHeading();
    containerEl.createDiv({
      cls: "setting-item-description wcm-uri-help",
      text: "If the Advanced URI plugin is installed you can trigger these commands from links, shortcuts, or other apps using: obsidian://adv-uri?vault=YourVault&commandid=simple-meeting-sidebar%3Arefresh-todays-meetings. Replace commandid with any of the exposed commands below; the : must be encoded as %3A.",
    });
    const uriList = containerEl.createDiv({ cls: "wcm-uri-list" });
    for (const command of [
      ["Refresh today's meetings", "refresh-todays-meetings"],
      ["Add next meeting as task", "add-next-meeting-as-task"],
      ["Create next meeting note", "create-next-meeting-note"],
    ] as const) {
      uriList.createDiv({
        cls: "wcm-uri-row",
        text: `${command[0]} → simple-meeting-sidebar:${command[1]}`,
      });
    }
  }

  private async displayCalendarChoices(container: HTMLElement): Promise<void> {
    try {
      const calendars = await this.calendarPlugin.getAvailableCalendars();
      if (!container.isConnected) return;
      container.empty();

      if (calendars.length === 0) {
        container.createDiv({
          cls: "setting-item-description",
          text: this.calendarPlugin.isSnapshotReader() ? "No calendars have arrived yet." : "No Apple calendars were found.",
        });
        return;
      }

      for (const calendar of calendars) {
        const setting = new Setting(container)
          .setName(calendar)
          .addToggle((toggle) => toggle
            .setValue(this.calendarIsSelected(calendar))
            .onChange(async (value) => {
              const selected = this.calendarPlugin.settings.selectedCalendars === null
                ? new Set(calendars)
                : new Set(this.calendarPlugin.settings.selectedCalendars);
              if (value) selected.add(calendar);
              else selected.delete(calendar);

              this.calendarPlugin.settings.selectedCalendars = calendars.every((name) => selected.has(name))
                ? null
                : [...selected].sort((left, right) => left.localeCompare(right));
              await this.calendarPlugin.saveSettings();
              this.calendarPlugin.renderViews();
              if (this.calendarPlugin.isPublishing()) void this.calendarPlugin.refreshToday().catch(() => undefined);
            }));
        setting.settingEl.addClass("wcm-calendar-setting");
      }
    } catch (error) {
      if (!container.isConnected) return;
      const message = error instanceof Error ? error.message : "Apple calendars could not be loaded.";
      container.empty();
      container.createDiv({ cls: "setting-item-description", text: message });
    }
  }

  private calendarIsSelected(calendar: string): boolean {
    const selected = this.calendarPlugin.settings.selectedCalendars;
    return selected === null || selected.includes(calendar);
  }
}
