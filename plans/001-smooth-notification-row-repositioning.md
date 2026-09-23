# 001: Smooth notification row repositioning

- **Status:** DONE
- **Commit:** `401d501`
- **Severity:** LOW
- **Category:** Missed opportunities; preventing a jarring change
- **Estimated scope:** 5 source/style files and existing notification tests; roughly 150–250 changed lines
- **Project:** `/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar`
- **Snapshot:** These instructions describe the working tree on 2026-09-23, including uncommitted notification work. The commit alone does not contain that work. Save existing changes and check the excerpts below before editing.

## Problem

Implemented on 2026-09-23. Layout snapshots are taken after persistence succeeds, immediately before rendering, so a failed save cannot leave a pending snapshot. `src/notification-motion.ts` owns measurements, retargeting, and disposal. The full check passes: 55 automated tests and the calendar-helper self-test. In-app motion feel has not been checked by the user.

Pointer dismissal already fades a banner leftward for 160ms. When the saved event disappears, surviving banners jump upward. Keep the accepted appearance, entry, and exit; add only movement for the surviving rows following a pointer dismissal.

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/src/meeting-notifications.ts:137` currently removes missing rows immediately:

```ts
for (const [key, row] of previous) {
  if (!next.has(key)) row.element.remove();
}
this.rows.set(container, next);
```

The renderer already saves row identity in a WeakMap, and `MeetingWidget.updateDOM()` reuses the editor container. Keep both. Some changed rows are replaced, so match measurements by event key, not just node identity.

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/src/view.ts:315` currently creates this action:

```ts
const dismiss = () => controller.runEventAction(event, () => controller.dismissEvent(event, notification));
```

`/Users/wren/Documents/wrens plugins/Released/simple-meeting-sidebar/src/main.ts:419` currently saves the dismissal:

```ts
async dismissEvent(event: CalendarEvent, notificationOnly = false): Promise<void> {
  await this.updateEventState(event.key, notificationOnly
    ? { notificationHidden: true }
    : { sidebarHidden: true });
}
```

## Target

- Gate: occasional pointer dismissal; purpose is preventing a jarring change. No animated reordering on typing, keyboard dismissal, initial mount, calendar refresh, theme changes, or background updates.
- After the existing exit finishes, surviving rows move from their previous visible vertical positions to their new positions in **200ms**.
- Animate **transform only**, using `cubic-bezier(0.77, 0, 0.175, 1)`.
- Use full transform keyframes: `translateY(<oldTop - newTop>px)` to `translateY(0px)`. No scale, bounce, opacity changes to survivors, height animation, or delayed input.
- Under `(prefers-reduced-motion: reduce)`, skip vertical movement. Keep the existing 100ms opacity-only dismissal. Keyboard dismissal remains immediate.
- Limit movement to the plugin's banners. Do not animate the note, Influx, backlinks, or Obsidian's workspace.
- Keep the current immediate cleanup when the last banner disappears; there are no survivors to animate. Do not leave an empty widget to manufacture a footer animation.

## Repo conventions to follow

- Use CSS and the Web Animations API; no dependencies.
- `styles.css` scopes notification motion under `.wcm-notifications` and defines `--wcm-notification-ease: cubic-bezier(0.23, 1, 0.32, 1)` for entry/exit. Keep it and add one sibling token, `--wcm-notification-layout-ease: cubic-bezier(0.77, 0, 0.175, 1)`, for on-screen repositioning.
- `src/view.ts:322` already checks the row's own window for reduced motion, starts from current visual values, and cancels completed WAAPI effects. Follow that ownership and cleanup pattern.
- Detached nodes must use their owning document's `createElement`. Obsidian's Node creation helpers can append immediately.
- Respect CodeMirror's read/write phases. Its installed `MeasureRequest` definition is in `node_modules/@codemirror/view/dist/index.d.ts:485`: read callbacks gather geometry, write callbacks update DOM without triggering layout.

## Steps

1. In `src/view.ts`, extend the controller contract to `dismissEvent(event: CalendarEvent, notificationOnly?: boolean, animateLayout?: boolean): Promise<void>`. Pass `notification && mouseEvent.detail > 0` as the third argument from the close action. Keep the existing close fade and keyboard bypass. Do not infer input origin from the globally active element.
2. In `src/main.ts`, accept `animateLayout = false`. For notification dismissal only, obtain a one-use layout snapshot from `MeetingNotifications` immediately before updating the event. Associate it with the dismissed event key. Retire it after the resulting removal, failed persistence, disabled notifications, or view disposal. Other callers default to immediate updates.
3. In `src/meeting-notifications.ts`, add a focused layout coordinator. Capture positions for currently mounted notification containers and their keyed rows before the model mutation. The capture occurs from the explicit action boundary, never from `MeetingWidget.updateDOM()` or a CodeMirror view update. If a view is not safely measurable, skip motion there rather than forcing a layout read during an editor update.
4. Capture all row rectangles in a batch before any animation cancellation or DOM write. Store row tops relative to the container so a scroll during saving does not turn into a large animation. For a row already moving, use its current visible position, cancel only its previous layout animation after the read batch, and let the next transition start there. Use per-container generations to discard stale queued work. Do not cancel entry or exit effects.
5. Run the existing keyed reconciliation. Consume a snapshot only when its dismissed key is actually removed, not on the earlier busy-state render. Schedule final measurements through each editor's `requestMeasure` read phase; in reading mode use the owning window's animation frame with separate read and write batches. Do not call `getBoundingClientRect`, `getComputedStyle`, or other layout readers inside `updateDOM`. Do not dispatch editor transactions from a measurement callback.
6. In the write phase, animate surviving rows with a nonzero vertical delta. Measure first, then start all animations. Keep new rows on their existing entrance path. Skip a survivor with an active horizontal entrance or dismissal instead of competing for its `transform`. After the 200ms movement, cancel the finished layout effect to release its transform override. Retarget repeated dismissals from their current visible positions.
7. Cancel pending frames, measurement generations, and owned animations on widget destruction, reading-footer removal, plugin unload, or file changes. Use `MeetingWidget.destroy(dom)` for editor cleanup if needed. No pending callback may mutate detached nodes or save another dismissal. Work in each pane's owning window, including pop-out windows.
8. Extend `tests/notification-dom.test.cjs` with mocked rectangles, measurement scheduling, and animation completion. Keep existing DOM identity, entry/exit, and unchanged-note tests. Update controller fixtures for the optional argument. Do not change note decoration placement in `src/notification-editor.ts`.

## Boundaries

- Only notification survivors after pointer dismissal are in scope. Sidebar list animations, refresh animations, drag physics, button feedback, and new settings are out of scope.
- Keep the approved gray default, lighter left-aligned times, 12px gaps, theme radius, shadow, and right-to-left exit.
- Do not make persistence wait for the new 200ms survivor animation. The existing exit delay stays as it is.
- Do not install libraries, publish releases, change the Swift helper, edit vault notes for testing, or use app controls.
- If the cited architecture has changed, report the mismatch before implementing a different design.

## Verification

Run from the absolute project directory:

```sh
npm run build:plugin
npm run lint
npm run test:ts
npm run test:dom
git diff --check
```

Expected: successful build, no lint errors or new warnings, all tests pass. The starting tree has two intentional detached-element lint warnings in `meeting-notifications.ts`.

Automated cases:

- Remove the first of three rows: only the two survivors move, once, for 200ms; final order and keys are correct.
- Remove the middle row: only the following row moves.
- Remove two rows rapidly: the next movement starts at the current visible position; no stale completion cancels the newer animation.
- Busy-state updates before dismissal do not consume the snapshot or replay entry.
- Failed action, disconnected view, another file, empty list, and unload leave no pending motion or placeholder footer.
- Keyboard dismissal, reduced motion, unrelated refreshes, typing, and theme changes start no layout animation.
- Reading and editing modes use their correct measurement scheduler and window. Note text and Influx ordering remain unchanged.

**Feel check, performed by the user:** dismiss the first and middle rows normally, then dismiss two quickly. Remaining rows should settle upward without a flash, sideways twitch, or bounce. With animation playback slowed to 20%, movement must start at the last visible position and end at the real layout position. Repeat with reduced motion: the dismissed row fades, and survivors reposition immediately. The agent must not operate app controls or request computer control.

**Done when:** the tests pass and the implementation handles every listed lifecycle case. Report automated validation separately from any visual check the user has not yet performed.
