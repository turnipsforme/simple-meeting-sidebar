# Mobile support with a calendar snapshot

## Baseline and scope

Baseline: commit `0492b10`, tag `baseline/pre-mobile-0.6.0`. Work lives on `feature/mobile-calendar-snapshot`. All 55 existing tests and the Swift helper self-test pass before changes. Keep the existing sidebar actions, calendar filters, daily-note integrations, people matching, editor widgets, reading-mode banners, dismissal animation, and desktop scheduling.

## Architecture

- Keep Apple Calendar as the default source on Mac. Dynamically import its service only behind Obsidian platform checks. Mobile and other desktop platforms read a snapshot; all Macs publish by default, without a source or publisher preference.
- Every Mac publishes `Meetings/_calendar/events.json`. Keep this path fixed and independent of the note folder/settings profile. Device identity lives in Obsidian's device-local vault storage, never synced plugin settings. Compare fetch-start timestamps before publishing, including inside a local vault.process update. Accept newer snapshots from any publisher. Device-local high-water timestamps reject delayed older deliveries; this is not a distributed lock. All publishing Macs must use the same calendar accounts and selection.
- Fetch yesterday through the end of the next seven days with one helper request. Publish a versioned, size-bounded document with writer identity, timestamp, exact UTC coverage boundaries, source time zone, selected calendars, and sanitized event fields. No actions, unrelated settings, calendar descriptions, or note contents go in the snapshot. A successful empty response replaces previous events, including cancellations.
- Treat the entire snapshot as invalid if any event or metadata is invalid. Reject oversized, duplicate, future-dated, reversed, incomplete, and regressing snapshots. Keep the last valid data in local storage, but disable reader notifications after a failed or missing read until a valid current file returns. Never treat invalid input as an empty calendar.
- Move cached events, refresh metadata, sidebar initialization and event action state out of synced `data.json` into device-local vault storage. Migrate the previous desktop cache once. A reader never trusts a legacy cache for notifications.
- Read on layout readiness, exact file create/modify/delete/rename, and foreground resume. Coalesce overlapping reads and ignore superseded read results. No phone calendar polling. Use one timeout for the next midnight or notification freshness expiry, and clean up all listeners and timers.

## Freshness and UI

- A reader banner needs a successfully verified file, complete coverage of the current local day, and an update no more than one hour old. Expire existing banners without waiting for another interaction. This cannot detect upstream changes that have not synced; the one-hour rule is an explicit upper bound, not a guarantee of live calendar truth.
- Keep valid saved events in the sidebar across midnight and show the actual refresh date/time on mobile only. Desktop presentation stays unchanged. Clearly distinguish no received data, no coverage for today, valid empty days, and saved data awaiting a valid sync.
- Never initialize/open/expand the sidebar automatically on mobile. User-invoked sidebar commands can open it. Retain native mobile tab navigation. Add a visible, accessible reload button in the mobile sidebar. Touch controls are at least 44px, long titles wrap, and banners use the existing CodeMirror extension on all devices.
- Reader refresh means reload the received file, not contact Apple Calendar. Sync problems do not create notices or error banners on mobile.

## Notes, tasks, and duplicates

- Keep existing note titles and templates; add a frontmatter event identity to new notes. Reuse a matching note anywhere in the vault using the metadata index, with bounded fallback reads before creation when metadata has not caught up.
- Mark new tasks with an invisible event identity and use that before title matching, including when time display or event title changes.
- Independent offline edits cannot be serialized across devices. Never overwrite or delete conflicting notes automatically. If multiple synced notes have the same identity, open a chooser so the user can choose which to use. Existing untagged notes cannot be matched with certainty; retain current local action state during migration.

## Verification

Run lint, type checking, release packaging, all existing tests, helper tests, and new automated tests covering:

- Entry bundle import and lifecycle with no Node/process globals, no sidebar auto-open, no mobile interval polling.
- Snapshot round trips, malformed/truncated JSON, size limits, invalid dates, full-day coverage across DST/time zones, duplicate IDs, calendar selection privacy, cancellation, clock skew, freshness expiry, older deliveries and multiple publishers and out-of-order delivery.
- Serial/coalesced reads, resume, deletion, rename, reappearance, failed publication, migration, local dismissals and settings/cache separation.
- Same-event note reuse after sync and before metadata indexing, recurring occurrences, changed titles, duplicate selection, task identity and concurrent local actions.
- Real CodeMirror document text/undo and reading-mode footer behavior, notification suppression on freshness changes, touch CSS and mobile controls.

No app control testing. Physical iPhone behavior, keyboard/safe areas and real Obsidian Sync transport need the user's final device check. Record actual automated results and remaining device checks before delivery. Publish a testing prerelease when requested by the user; keep the stable release unchanged until device validation.

## Implemented result and checks

- Package version: 0.7.0. Minimum Obsidian version: 1.8.7, for the public device-local vault storage API. No publisher preference: all Macs publish.
- Baseline: 55 automated tests. Completed: 84 automated tests (52 TypeScript, 32 integration/DOM), plus the rebuilt universal helper self-test.
- `npm run check` passes lint, type checking, bundling, packaging and the full test suite. The final extra 9,000-event indexing/unchanged-reload regression also passes. Lint reports 13 warnings: nine Node imports inside guarded, lazily loaded Mac modules, three existing detached DOM creation warnings, and one literal path/settings-name sentence-case warning. No lint errors. The actual release bundle is evaluated with Node/process/Buffer unavailable in the mobile test.
- Built and ad-hoc signed both Apple Silicon and Intel helper architectures. The release folder contains separate `main.js`, `manifest.json`, `styles.css` and optional desktop helper files.
- Added tests cover snapshot validation, selected-calendar privacy, future timestamps, cancellations, older deliveries, multi-Mac writes, overlapping reads, settings arriving during refresh, foreground resume, rename/delete/reappearance, unload, local-state migration/restart, failed publication, silent mobile startup, notification expiry, DST, all-day dates while travelling, note collisions and reuse, recurring occurrences, task IDs, editor text stability, and mobile-only sidebar controls.
- Efficiency checks: no mobile intervals, no reads for unrelated file changes, one snapshot read in flight, no writes on unchanged reloads, no repeated date parsing when rendering a 9,000-event cache. The snapshot event list is stored once in device-local storage. No whole-vault reads during rendering.
- These are mocked-vault, real CodeMirror/JSDOM, bundle and native helper self-tests. They do not establish actual iPhone frame timing, Apple Calendar permission behavior, or real Obsidian Sync ordering. Wider calendar retrieval necessarily reads more events per refresh; end-to-end performance on the user's calendar and phone remains to be checked.

## iPhone acceptance check

1. Save a backup of the current plugin folder/data.json, then install the three files from `release/simple-meeting-sidebar` on Mac and iPhone. Use Obsidian 1.8.7 or later. Existing note text is not migrated or rewritten.
2. Enable **Sync all other types** on both devices, keep `Meetings/_calendar` included, and refresh on a Mac. Check that `events.json` arrives on the phone.
3. Confirm that enabling/restarting the plugin never opens the phone sidebar. Open it explicitly and check its received-data/empty-day text and reload button.
4. Enable meeting notifications and open today's daily note in editing and reading modes. Check long titles, 44px buttons, portrait/landscape, light/dark themes, keyboard appearance, typing and undo. The editor remains Obsidian's editor.
5. Dismiss a phone banner; confirm the Mac dismissal state stays independent. Create a task and note on one device, allow sync to finish, then use the same actions on the other device. Confirm reuse.
6. Cancel or change a test event, refresh either Mac, then check that the phone updates. Leave a snapshot for over an hour and confirm its banners disappear while saved sidebar meetings remain.
7. Briefly take the phone offline, return to Obsidian, and confirm there are no calendar sync error notices. Bring it online and let a valid newer snapshot restore the appropriate banners.

The user requested a public testing prerelease on September 24. Keep it marked as a prerelease until this device check is complete. Offline duplicate notes/task lines remain intact for the user to resolve; no automated deletion or merging is performed.
