# 002: Keep meeting lists steady during refresh

- **Status:** SUPERSEDED by handle feedback
- **Commit:** `401d501`
- **Severity:** LOW
- **Category:** Missed opportunities; state indication
- **Estimated scope:** 4 source/style files, optionally one small view helper, and one DOM test file; roughly 150–250 changed lines
- **Project:** `/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar`
- **Snapshot:** Based on the working tree on 2026-09-23, including uncommitted notification changes. Check the excerpts below; do not reset the tree to the stamped commit.

## Problem

The user subsequently requested removal of the reserved status space. The current implementation keeps only a screen-reader announcement and pulses the existing sidebar handle three times on pointer refresh. Keyboard and reduced-motion refreshes use a steady highlight. The original plan below is historical and must not be reapplied.

Implemented on 2026-09-23 using `src/refresh-status.ts` and persistent status nodes in both views. The full check passes: 55 automated tests and the calendar-helper self-test. An isolated headless layout fixture verified identical list position across idle/loading/idle states and no banner overflow at 180, 240, 320, 420, 520, and 800px pane widths with 16px and 24px text. The plugin remains desktop-only. In-app motion feel has not been checked by the user.

Both the sidebar and calendar modal rebuild their contents and insert a refresh label above the list only while refreshing. The label's arrival and removal change the list's position. Unrelated renders also recreate the label, preventing an interruptible fade.

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/src/view.ts:161`:

```ts
render(): void {
  const container = this.contentEl;
  container.empty();
  container.addClass("wcm-view");

  if (this.controller.isRefreshing()) {
    container.createDiv({ cls: "wcm-refreshing", text: "Refreshing calendars…" });
  }
```

`CalendarEventsModal.render()` repeats this pattern at `src/view.ts:212`.

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/styles.css:85`:

```css
.wcm-refreshing {
  margin-bottom: var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
```

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/src/main.ts:171` exposes `refreshToday(manual = false)`. The existing `manual` flag controls restoring hidden events and notices. It does not identify pointer input: commands and the settings refresh button both pass `true`, while the sidebar pill passes `false`.

## Target

- Gate: occasional pointer refresh; purpose is state indication. Keep cached meeting rows readable throughout the refresh.
- Save a persistent, single-line status slot above the content in both sidebar and modal. Reserve its space while idle so refresh alone never shifts the list.
- The status slot has `min-height: 1.4em`, `line-height: 1.4`, the existing `var(--font-ui-small)` font size, and `margin-bottom: var(--size-4-3)`. Keep the fixed label on one line with overflow ellipsis and its full accessible text.
- Fade the label between opacity 0 and 1 over **160ms**, using **`cubic-bezier(0.23, 1, 0.32, 1)`**. No transform, pulse, spinner, shimmer, or artificial minimum loading duration.
- Under `(prefers-reduced-motion: reduce)`, use **100ms**, opacity only.
- Keyboard/command, scheduled, and programmatic refresh status changes are immediate. Initial view mount shows the correct state immediately, even when a refresh is already running.
- Fast repeated pointer refreshes retarget from current opacity. Never rebuild the label to restart an animation.

## Repo conventions to follow

- The notification easing is already `--wcm-notification-ease: cubic-bezier(0.23, 1, 0.32, 1)` in `styles.css`. Define `--wcm-ease-out` on the plugin's own surface roots (`.wcm-view`, `.wcm-calendar-modal`, `.wcm-notifications`), then make `--wcm-notification-ease` reference it. Do not place plugin tokens on global `body` or change notification timing.
- Continue using native Obsidian controls, theme text colors, and existing error/empty-state copy.
- `refreshToday` already deduplicates concurrent fetches using `refreshPromise`. Keep that behavior.
- This is a status-node lifecycle refactor, not a rewrite of all meeting rows or calendar loading.

## Steps

1. In `src/view.ts`, extend `SimpleMeetingSidebarController.refreshToday` to accept an optional second boolean `animateStatus`, defaulting to false in the implementation. Add a read method `shouldAnimateRefreshStatus(): boolean`. Keep the existing meaning of the first `manual` argument.
2. In `src/main.ts`, store the animation preference for the currently accepted refresh operation. Check for an existing `refreshPromise` before changing the preference. Save the new preference before the initial `renderViews()` call. Retain it through the completion render so fade-out uses the same policy, and replace it when the next actual refresh begins. The getter reads this transient preference; do not save it in plugin settings.
3. The sidebar pill's non-drag mouse release calls `refreshToday(false, true)`. In `src/settings.ts`, accept the button click event and pass `event.detail > 0` as the second argument to `refreshToday(true, ...)`. Command callbacks, scheduled refreshes, filter-triggered refreshes, and modal-opening refreshes omit the second argument. Do not animate modal opening or change the commands.
4. Give the sidebar and modal persistent status and body elements. Create them once per open view. Stop calling `container.empty()` on the entire root for every render. Update only the body when its existing rendering needs to run; leave the status slot and label connected. On close, clear references and normal subscriptions so reopening creates fresh elements without a stale transition.
5. Add a small shared status updater in `src/view.ts` or `src/refresh-status.ts`, used by both views. Inputs are the element, refreshing boolean, pointer-animation policy, and whether it is its first render. Only toggle state when it changes. Use opacity CSS transitions, not keyframes or a new dependency. Give instant and initial updates a scoped class with `transition: none`; subsequent pointer state changes use the 160ms transition without forcing a layout read.
6. Keep the visible label text through fade-out. Use a separate visually hidden `role="status"` live node that announces `Refreshing calendars…` once when loading begins and clears on completion. Mark the visual label `aria-hidden="true"` to avoid duplicate announcements or an invisible idle status being read. Do not repeatedly announce on unrelated renders. Add no new success announcement or notice.
7. Error messages remain in the body and appear immediately, as today. Empty-calendar handling remains unchanged. Do not hide errors until a fade completes. Maintain drag offset behavior and the existing modal scroll limit.
8. Add DOM coverage for stable status-node identity, transition policy, busy/idle states, fast updates, and opening/closing. Update controller test fixtures for the getter. For reserved-space checks use a static CSS assertion or a headless layout fixture; jsdom does not calculate real layout, so do not claim jsdom proves unchanged on-screen coordinates.

## Target CSS behavior

Use selectors consistent with the existing plugin prefix. The state class names below are the intended contract:

```css
.wcm-refreshing {
  min-height: 1.4em;
  line-height: 1.4;
  margin-bottom: var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.wcm-refreshing-label {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 160ms var(--wcm-ease-out);
}
.wcm-refreshing.is-refreshing .wcm-refreshing-label { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .wcm-refreshing-label { transition-duration: 100ms; }
}
.wcm-refreshing.is-instant .wcm-refreshing-label { transition: none; }
```

The announcement node must be visually hidden without using `display: none` or `visibility: hidden`, and must not add layout height. Do not reuse the visual fading label as the live region.

## Boundaries

- Do not alter event caching, calendar permissions, polling intervals, helper code, manual-refresh semantics, saved settings, or notice wording.
- Do not add list entrances, button press effects, modal transitions, fake progress, or a delay to the calendar operation.
- Keep the notification appearance and entry/exit behavior accepted in this task.
- No new dependencies, releases, or app-control testing. Do not edit vault notes as fixtures.
- If source drift changes the architecture in these excerpts, report it before broadening the refactor.

## Verification

From the absolute project directory:

```sh
npm run build:plugin
npm run lint
npm run test:ts
npm run test:dom
git diff --check
```

Expected: build succeeds, tests pass, no new lint errors or warnings. Two detached-element warnings already exist in `meeting-notifications.ts`.

Automated cases:

- The same status slot and visual label survive repeated busy/idle renders, and their reserved-space class remains present in both states.
- Pointer refresh starts and finishes with the animated policy; keyboard and scheduled refreshes are instant.
- A second request during an existing fetch does not replace its input policy or start another fetch.
- A view opened during an existing refresh shows its current state without an entrance animation.
- Fast busy/idle/busy changes do not remove and recreate nodes, add timeouts, delay fetching, or replay announcements unnecessarily.
- Errors stay visible immediately; empty calendars, modal reopening, and sidebar drag positioning still work.
- Reduced-motion CSS changes only fade duration; instant keyboard updates remain instant due to selector precedence.
- Existing notification tests pass after sharing the easing token.

**Feel check, performed by the user:** refresh from the sidebar pill and settings button with cached meetings visible. The first meeting's top position should stay fixed as the label appears and disappears. Quickly repeat a refresh and check that opacity reverses without a flash. Open the calendar modal during a refresh, then test a command-palette refresh and reduced motion. Slowed to 20% playback, only the label's opacity should change. The agent must not operate app controls or request computer control.

**Done when:** status transitions follow the input policy, persistent nodes survive refresh renders, and all automated checks pass. Report any unperformed human visual checks explicitly.
