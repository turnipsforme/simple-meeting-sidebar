# Calendar Meetings

A macOS-only Obsidian plugin that reads events from Apple Calendar, shows today's events in the right sidebar, and turns an event into either a daily-note task or a meeting note with one click.

## Install

Download the versioned `calendar-meetings-*.zip` file from the latest GitHub release, extract it, and copy the included `wrens-calendar-meetings` folder to:

```text
<your vault>/.obsidian/plugins/wrens-calendar-meetings
```

The copied folder must include at least:

```text
bin/calendar-helper
main.js
manifest.json
styles.css
```

Standard Obsidian installers that download only `main.js`, `manifest.json`, and `styles.css` are also supported. The signed universal Apple Calendar helper is embedded in `main.js` and is installed into `bin/calendar-helper` with executable permissions the first time it is needed.

Restart Obsidian, enable **Calendar Meetings** under Community plugins, and allow Calendar access when macOS asks. The helper only reads events; it never writes to Apple Calendar.

On a new install, the plugin adds its view to the right sidebar once. If you close it, it stays closed across later Obsidian launches. Run **Calendar Meetings: Open meetings sidebar** whenever you want it back.

## Use

- Hover an event and click `•` to add `- [ ] Event title` under the detected Tasks heading in today's daily note.
- Click `••` to create and open a note in `Meetings`.
- Run **Calendar Meetings: Refresh today's meetings** for an immediate refresh.
- Run **Calendar Meetings: Open meetings sidebar** to reveal the sidebar.
- Run **Calendar Meetings: Today's calendar events** to refresh Apple Calendar and open a floating window containing both today's and yesterday's events, with the same task and meeting-note buttons.

After either action succeeds, that event is hidden from the sidebar for the rest of the refresh cycle. A manual refresh restores handled events to the list, while preserving which task or meeting note was already created.

New meeting notes link back to the daily note with a readable date label such as `Mon, Aug 3 2026`. Meeting-note numbering also recognizes an existing suffix followed by a dash, so `Meeting 12 - follow-up` makes the next note `Meeting 13`.

The default schedule is once per day at 08:00 local time. The plugin checks regularly while Obsidian is open, retries later after a failed refresh, and catches up at startup if Obsidian was closed when a refresh became due. The setting can be changed to manual or another Readwise-style interval.

In the plugin settings, each Apple calendar can be included or excluded. You can also limit the sidebar to events that contain a `meet.google.com` link in their URL, location, or notes. Event titles are shown without emoji or a time prefix.

## Person matching

Only Markdown notes inside `People` with the exact tag `#Person` are indexed. Matching uses the note title and, by default, its `alias` or `aliases` property. The index is built lazily only when a meeting note is created, and then reused until a relevant People note changes.

## Development

Requirements: Node.js 20 or newer and Xcode Command Line Tools.

```bash
npm install
npm run check
```

`npm run check` type-checks and bundles the Obsidian plugin, builds and ad-hoc signs a universal Apple Silicon/Intel Swift helper, creates the lean release folder, then runs the TypeScript and helper self-tests.
