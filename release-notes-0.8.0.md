# Inline meetings and mobile support

Simple Meeting Sidebar 0.8.0 brings inline meetings and synced mobile support to the stable release. Update through Obsidian’s Community plugins; BRAT is no longer needed.

- See upcoming meetings directly in daily notes on Mac, iPhone, iPad and Android. Mobile reads the calendar snapshot synced from your Mac.
- Show up to three inline meetings, followed by a muted **+ X more** count. Handling a meeting fades the next one into its slot without shifting the other banners.
- Keep banners immediately above Influx, with an 8px gap that survives editor and theme overrides.
- Fix mobile action buttons shrinking during a tap. Add task, create meeting note and dismiss keep stable touch targets, and editor gestures no longer handle their touches.
- Show tomorrow’s meetings only in tomorrow’s note, from 5pm local time.
- Rename **Meeting notifications** to **Inline meetings** in settings, with a single tooltip per button.
- Add **Ignore all day events** (on by default) and **Ignore repeating events** (off by default).
- Create tasks with just the title and optional time. All-day tasks never include a time or “All day” prefix, and new tasks contain no tracking comments.
- Keep task creation and manual refresh quiet. Only automatic refresh announces added or updated meetings.

## Updating

Requires Obsidian 1.8.7 or later. Update your Mac and mobile devices, then refresh meetings on your Mac so recurring-event details reach the synced snapshot. With Obsidian Sync, enable **Sync all other types** on each device for `Meetings/_calendar/events.json`. Mobile inline meetings require a snapshot less than one hour old.

The release includes separate `main.js`, `manifest.json` and `styles.css` files. The universal Mac calendar helper is embedded in `main.js`.

## Validation

Type checking, the production build, TypeScript and DOM regression tests, mobile bundle loading, and the Mac helper self-test pass. Mobile interactions were checked with automated DOM tests; this release was not tested by driving the Obsidian app.
