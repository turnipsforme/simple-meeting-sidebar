# Simple Meeting Sidebar

> **macOS only.** Simple Meeting Sidebar uses Apple Calendar and does not run on Windows, Linux, iPhone, iPad, or Android.

A simpler, more minimal meetings plugin. There is no setup beyond allowing your Mac's Calendar access and picking which calendars you would like included.

Simple Meeting Sidebar shows today's Apple Calendar events in the right sidebar. With one click, you can add an event to your daily note as a task or create a meeting note.

## Getting started

1. Install and enable **Simple Meeting Sidebar**.
2. Allow Calendar access when macOS asks. The plugin only reads events and never writes to Apple Calendar.
3. Open the plugin settings and choose which Apple calendars to include.

The plugin adds its view to the right sidebar on first launch. If you close it, run **Simple Meeting Sidebar: Toggle meetings sidebar** to bring it back. Drag the small pill at the top to reposition the view, or click it to refresh today's meetings.

## Use

- Hover over an event and click `•` to add `- [ ] Event title` under the Tasks heading in today's daily note.
- Click `••` to create and open a note in `Meetings`. By default, the meeting note is also linked from today's daily note.
- Run **Simple Meeting Sidebar: Refresh today's meetings** for an immediate refresh.
- Run **Simple Meeting Sidebar: Toggle meetings sidebar** to show or hide the sidebar.
- Run **Simple Meeting Sidebar: Add next meeting as task** or **Create next meeting note** to handle the next event from anywhere.
- Run **Simple Meeting Sidebar: Today's calendar events** to open a floating window with today's and yesterday's events.

After an action succeeds, the event stays hidden until the next manual refresh. Existing tasks and meeting notes are still remembered.

## Settings

- Include or exclude individual Apple calendars.
- Show only events containing a `meet.google.com` link.
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

Simple Meeting Sidebar accesses Apple Calendar data outside your vault, including event titles, times, locations, notes, URLs, calendar names, and guest names. This data is processed locally on your Mac and saved only in the plugin's local settings cache. The plugin does not use network services, collect telemetry, or write to Apple Calendar.

## Development

Requirements: Node.js 20 or newer, macOS, and Xcode Command Line Tools.

```bash
npm install
npm run check
```

`npm run check` type-checks and bundles the plugin, builds and signs a universal Apple Silicon and Intel helper, creates the release folder, and runs the TypeScript and helper self-tests.
