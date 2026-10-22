# Week-ahead inline meetings

Simple Meeting Sidebar 0.9.0 can show the coming week's meetings in each day's daily note, and includes a round of reliability and performance fixes.

- Add **Show the week ahead** under **Inline meetings**. When it's on, each of the next seven daily notes shows that day's meetings at any time of day, instead of only tomorrow's after 5pm. It's off by default, so nothing changes unless you turn it on.
- Each day's banner buttons act on that day's note and name it, for example “Add to Friday's tasks”. Meeting notes link back to the same daily note.
- Week-ahead banners use the meetings from your latest refresh, which always covers the next seven days. Days that an older refresh doesn't cover stay empty rather than showing out-of-date meetings.
- With a daily-note format that has no day in it, such as weekly notes, several dates map to the same note. The earliest date now keeps that note instead of a later date replacing it.
- Returning to Obsidian no longer rereads every synced dismissal record, and one app activation that fires both focus and visibility events is handled once.
- Messages that used to say “today's daily note” now say “the daily note”, because actions can target other days.

## Updating

Requires Obsidian 1.8.7 or later. The new setting syncs with your other plugin settings. On mobile, week-ahead banners follow the existing rule: they appear only while the synced snapshot is less than one hour old.

The release includes separate `main.js`, `manifest.json` and `styles.css` files. The universal Mac calendar helper is embedded in `main.js`.

## Validation

Type checking, lint, the production build, TypeScript and DOM regression tests (including new week-ahead, date-label and settings tests), and the Mac helper self-test pass. This release was not tested by driving the Obsidian app.
