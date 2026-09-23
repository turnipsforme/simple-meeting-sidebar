# Animation plans

Prepared and implemented on 2026-09-23 against commit `401d501` plus the current uncommitted notification work.

| Order | Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- | --- |
| 1 | [Smooth notification row repositioning](001-smooth-notification-row-repositioning.md) | LOW | DONE | Existing keyed notification renderer and dismissal fade |
| 2 | [Keep meeting lists steady during refresh](002-stable-refresh-status.md) | LOW | SUPERSEDED: handle feedback | No reserved status space; user-requested revision |

Execute 001 first, then 002. There is no functional dependency between them, but both touch `src/view.ts`, `src/main.ts`, and `styles.css`, so sequential work avoids conflicting edits. Re-read the current files before each plan and keep the earlier plan's changes.

The execution order above is historical. Do not reapply plan 002: the user replaced its reserved loading slot with three gentle handle pulses. The dismissal renderer also now keeps exiting rows intact through busy updates and holds their hidden end state until removal, preventing a visible flash during saving.

Both plans specify exact timing, input-origin handling, reduced motion, cleanup, and automated checks. Visual feel checks belong to the user; do not use app controls. No new libraries or published releases are needed.

Validation: `npm run check` passed with 55 tests plus the Swift helper self-test, zero lint errors, and three detached-element style warnings. Responsive layout and refresh position passed in an isolated headless fixture. No Obsidian app controls were used. Mobile runtime support remains out of scope at the user's request.
