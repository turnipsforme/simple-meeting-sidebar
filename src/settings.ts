import { PluginSettingTab, Setting, type App } from "obsidian";
import type CalendarMeetingsPlugin from "./main";
import type { RefreshSchedule } from "./models";
import { normalizeVaultFolder, parseDailyTime } from "./utils";

export class CalendarMeetingsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly calendarPlugin: CalendarMeetingsPlugin) {
    super(app, calendarPlugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Calendar Meetings" });

    containerEl.createEl("h3", { text: "Events" });
    containerEl.createEl("p", {
      text: "Choose which Apple calendars contribute events. All calendars are used until you turn one off.",
      cls: "setting-item-description",
    });
    const calendarChoices = containerEl.createDiv();
    calendarChoices.createDiv({ cls: "setting-item-description", text: "Loading calendars…" });
    void this.displayCalendarChoices(calendarChoices);

    new Setting(containerEl)
      .setName("Only events with Google Meet links")
      .setDesc("Hide events unless a meet.google.com link is attached in the event URL, location, or notes.")
      .addToggle((toggle) => toggle
        .setValue(this.calendarPlugin.settings.onlyGoogleMeetEvents)
        .onChange(async (value) => {
          this.calendarPlugin.settings.onlyGoogleMeetEvents = value;
          await this.calendarPlugin.saveSettings();
          this.calendarPlugin.renderViews();
          if (value) void this.calendarPlugin.refreshToday(false).catch(() => undefined);
        }));

    new Setting(containerEl)
      .setName("Meetings folder")
      .setDesc("Meeting notes are created here. The default is Meetings.")
      .addText((text) => text
        .setPlaceholder("Meetings")
        .setValue(this.calendarPlugin.settings.meetingsFolder)
        .onChange(async (value) => {
          this.calendarPlugin.settings.meetingsFolder = normalizeVaultFolder(value, "Meetings");
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

    new Setting(containerEl)
      .setName("Calendar refresh schedule")
      .setDesc("Like Readwise, automatic refreshes only run while Obsidian is open. Manual never runs by itself.")
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

    new Setting(containerEl)
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
      .setName("Refresh now")
      .setDesc("Runs the same refresh as the “Refresh today's meetings” command.")
      .addButton((button) => button
        .setButtonText("Refresh")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.calendarPlugin.refreshToday(true);
          } catch {
            // refreshToday already reports the specific helper or permission error.
          } finally {
            button.setDisabled(false);
          }
        }));
  }

  private async displayCalendarChoices(container: HTMLElement): Promise<void> {
    try {
      const calendars = await this.calendarPlugin.getAvailableCalendars();
      if (!container.isConnected) return;
      container.empty();

      if (calendars.length === 0) {
        container.createDiv({
          cls: "setting-item-description",
          text: "No Apple calendars were found.",
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
