# Simple Meeting Sidebar

> **Mac + mobile.** Macs read Apple Calendar and publish a vault snapshot. iPhone, iPad, Android, Windows and Linux read that synced snapshot. Requires Obsidian 1.8.7 or newer.

A simpler, more minimal meetings plugin. There is no setup beyond allowing your Mac's Calendar access and picking which calendars you would like included.

Simple Meeting Sidebar shows today's Apple Calendar events in the right sidebar. With one click, you can add an event to your daily note as a task or create a meeting note.

## Getting started

1. Install and enable **Simple Meeting Sidebar**.
2. Allow Calendar access when macOS asks. The plugin only reads events and never writes to Apple Calendar.
3. Open the plugin settings and choose which Apple calendars to include.

On desktop, the plugin adds its view to the right sidebar on first launch. Mobile opens it only when you ask. If you close it, run **Simple Meeting Sidebar: Toggle meetings sidebar** to bring it back. Drag the small pill at the top to reposition the view, or click it to refresh today's meetings.

## Mobile and multiple Macs

Every Mac publishes after a successful calendar refresh. There is no publisher toggle. Use the same Apple Calendar accounts on your Macs; enabled calendars remain in the normal synced plugin settings. A newer fetch wins, based on its start time. Devices remember the newest valid snapshot they have received and reject older deliveries. Keep device clocks set automatically.

1. Update the plugin on your Mac and phone, then refresh meetings on the Mac.
2. Sync `Meetings/_calendar/events.json` as an ordinary vault file. The path is fixed, independent of your meeting-note folder and settings profile.
3. With Obsidian Sync, enable **Sync all other types** on each device and ensure `Meetings/_calendar` is not excluded. [Obsidian's sync settings](https://obsidian.md/help/sync/settings) explain the device-specific options.
4. Enable **Meeting notifications** if wanted. Mobile uses the same Obsidian editor extension and reading-mode footer, with wrapping titles and visible 44px touch controls.
5. Open **Toggle meetings sidebar** when you want the list. The plugin never opens the mobile sidebar automatically. **Reload synced meetings** reads the file already received on the phone; it does not ask a Mac to refresh.

Mobile shows an update time and distinguishes an empty day from missing data. Saved meetings remain available when old, but banners appear only after a valid snapshot read, with complete coverage of the phone's current day, matching calendar selection, and a fetch less than one hour old. Invalid, missing, conflicting or older files suppress banners while keeping the last valid sidebar data. The Mac refresh schedule stays unchanged, so a daily schedule gives a limited mobile banner window; choose hourly refresh if you want more frequent updates while a Mac is open. A fresh snapshot still cannot detect a cancellation that has not reached Apple Calendar or vault sync yet.

Mobile reads on startup, snapshot changes, and app resume. It does not poll or contact Apple Calendar. One local timer updates the date at midnight and removes expired banners. Desktop sidebar and banner presentation stay unchanged; freshness labels and reload controls appear only on mobile.

Dismissals and action state stay on each device. Notes and daily-note tasks sync normally. New notes carry a `simple-meeting-event` property, and new tasks carry an invisible event marker. Other devices recognise these after syncing, including title changes and separate recurring occurrences. Apple's [external calendar identifier](https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemexternalidentifier) is used when available; calendars without a stable external identifier cannot guarantee matching across Macs.

Simultaneous offline edits cannot be locked across devices. If multiple synced note files have the same event ID, creating the meeting again offers a chooser and leaves every note intact. Duplicate task lines left by a sync conflict are not deleted automatically, but the plugin will not add another copy of the marked event. Existing unmarked notes retain their local association during migration; they cannot be identified reliably on a different device. Moving a meeting to a different start time creates a new occurrence identity.

The test build is prepared on `feature/mobile-calendar-snapshot`. The unchanged 0.6.0 baseline is tagged `baseline/pre-mobile-0.6.0`. Switching back to that tag restores the old code; keep a backup of plugin `data.json` before testing if you also want to restore the old synced cache/action layout.

## Use

- Hover over an event and click `•` to add `- [ ] Event title` under the Tasks heading in today's daily note.
- Click `×` to hide a meeting from the sidebar and the daily-note banners.
- Click `••` to create and open a note in `Meetings`. By default, the meeting note is also linked from today's daily note.
- Run **Simple Meeting Sidebar: Refresh today's meetings** for an immediate refresh.
- Run **Simple Meeting Sidebar: Toggle meetings sidebar** to show or hide the sidebar.
- Run **Simple Meeting Sidebar: Add next meeting as task** or **Create next meeting note** to handle the next event from anywhere.
- Run **Simple Meeting Sidebar: Today's calendar events** to open a floating window with today's and yesterday's events.

After an action succeeds, the event stays hidden until the next manual refresh. Existing tasks and meeting notes are still remembered.

## Meeting notifications

Turn on **Meeting notifications** in settings to show today's meetings below today's daily note in editing and reading modes. This is off by default. The plugin follows your Daily Notes or Periodic Notes folder and date format.

Each compact banner shows a lighter local meeting time on the left, the title, and line icons to add a task, create a meeting note, or dismiss the notification. On a mouse, the extra actions appear when you move over the controls; they also appear on keyboard focus and stay visible on touch devices. Dismissing a banner leaves its sidebar row available. A sidebar dismissal or successful task/note action hides the meeting in both places. Automatic refreshes and restarts remember dismissals; **Refresh today's meetings** brings hidden events back.

The banners sit immediately above Influx's footer, also work without Influx, and never change your daily note's text. Influx's optional top-of-page placement stays at the top. Notifications reuse the existing event cache; there is no extra calendar polling.

**Neutral notifications** is on by default. Backgrounds, text, borders, rounded corners, and subtle shadows follow the active theme in light and dark mode. Existing color preferences are saved. Rows have a 12px gap and fade in from the right; mouse dismissal fades toward the left. Reduced motion uses a gentle fade without movement, and keyboard dismissal is immediate. CSS snippets can override `--wcm-notification-radius` or `--wcm-notification-shadow` (use `none` for a flat surface).

After a mouse dismissal, the remaining banners settle into place over 200ms. In narrow note panes, times and titles stack, long titles wrap, and controls move below the text. Refresh feedback uses the sidebar handle: three gentle pulses for a pointer refresh, or a steady highlight for keyboard refresh and reduced motion. No loading label or empty status space is added above meetings. Apple Calendar access still requires macOS.

## Settings

- Include or exclude individual Apple calendars.
- Show only events containing Google Meet, Zoom, or Microsoft Teams links. Existing Google Meet filter preferences carry over. Refresh after upgrading to detect Zoom and Teams in already-cached events.
- Enable meeting notifications below today’s daily note.
- Optionally include meeting time in newly created tasks, such as `- [ ] 10:30am Meeting with John`. Existing tasks stay unchanged.
- Choose the meeting-note and people folders.
- Decide whether meeting notes are linked from today's daily note.
- Ignore selected people when linking guests to `#Person` notes.
- Refresh manually, hourly, every 6 or 12 hours, daily, or weekly.

## Person matching

Only Markdown notes inside `People` with the exact tag `#Person` are indexed. Matching checks Apple Calendar guest names, then the event title, then the note title and optional aliases.

## Advanced URI integration

With [Advanced URI](https://github.com/Vinzent03/obsidian-advanced-uri) installed, commands can be triggered with a URL such as:

```text
obsidian://adv-uri?vault=YourVault&commandid=simple-meeting-sidebar%3Arefresh-todays-meetings
```

| Command ID | Action |
| --- | --- |
| `refresh-todays-meetings` | Refresh today's meetings |
| `add-next-meeting-as-task` | Add next meeting as task |
| `create-next-meeting-note` | Create next meeting note |

## Privacy and permissions

Simple Meeting Sidebar accesses Apple Calendar data outside your vault, including event titles, times, locations, calendar names, and guest names. It checks event URLs, locations, and notes for Google Meet, Zoom, and Microsoft Teams links; URLs and notes are not returned by the helper or saved by the plugin. Calendar data is processed locally on your Mac. Selected calendars are saved to `Meetings/_calendar/events.json`, which your vault sync service can transfer to your other devices. The snapshot contains yesterday, today, and the next seven days. Cached data and dismissals are saved in device-local vault storage, separately from synced plugin settings. The plugin does not use network services, collect telemetry, or write to Apple Calendar.

## Apple Calendar helper

Obsidian cannot read Apple Calendar directly, so the plugin includes a small native helper whose complete source is in [`helper/CalendarHelper.swift`](helper/CalendarHelper.swift). The release build embeds a universal Apple Silicon and Intel copy in `main.js`. The plugin checks the installed copy once per load and replaces it when the bundled helper changes. When needed, it writes that copy to its own `.obsidian/plugins/simple-meeting-sidebar/bin` folder, marks it executable, and launches it directly. It does not use a shell or run user-provided commands.

The helper has three jobs:

- Ask macOS for Calendar permission and report a clear error if access is denied.
- List the names of available Apple calendars for the plugin settings.
- Read occurrences from yesterday through the next seven days, returning only local and external event identifiers, title, start and end times, all-day status, calendar name, optional location, optional attendee names, and whether a supported meeting link was found.

The helper cannot create, edit, accept, decline, or delete calendar events. It cannot read files in your vault, make network requests, or run in the background without Obsidian. On macOS 14 and later, Apple labels the required EventKit permission as full Calendar access even though this helper only performs the read operations listed above. Some calendar providers may omit locations or attendee display names, so those details are not guaranteed to appear.

## Development

Requirements: Node.js 22 or newer. Rebuilding the native helper also requires macOS and Xcode Command Line Tools.

```bash
npm install
npm run check
```

`npm run check` lints, type-checks, bundles the reviewed helper, creates the release folder, and runs the TypeScript regressions, editor/reading-mode DOM regression, and helper self-tests. If `CalendarHelper.swift` changes, run `npm run build:helper` first to rebuild and ad-hoc sign the universal helper that release builds embed.
