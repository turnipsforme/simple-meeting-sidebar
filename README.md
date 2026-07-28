# Calendar Meetings

A macOS-only Obsidian plugin that reads today's events from Apple Calendar, shows them in the right sidebar, and turns an event into either a daily-note task or a meeting note with one click.

## Install

For the smallest copy, use the ready-made `release/wrens-calendar-meetings` folder. Copy that folder to:

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

Restart Obsidian, enable **Calendar Meetings** under Community plugins, and allow Calendar access when macOS asks. The helper only reads events; it never writes to Apple Calendar.

## Use

- Hover an event and click `•` to add `- [ ] Event title` under the detected Tasks heading in today's daily note.
- Click `••` to create and open a note in `Meetings`.
- Run **Calendar Meetings: Refresh today's meetings** for an immediate refresh.
- Run **Calendar Meetings: Show today's meetings** to reveal the sidebar.

The default schedule is once per day at 08:00 local time. If Obsidian was closed then, the first opening on a new day performs one catch-up refresh. The setting can be changed to manual or another Readwise-style interval.

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
