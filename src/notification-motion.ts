import type { EditorView } from "@codemirror/view";

interface MountedRows {
  rows: Map<string, HTMLElement>;
  editor: EditorView | undefined;
  generation: number;
  frame: number | undefined;
  animations: Map<HTMLElement, Animation>;
  pending: { removedKey: string; tops: Map<string, number>; easing: string } | undefined;
}

/** Measures only at the action boundary or in CodeMirror's scheduled read phase. */
export class NotificationMotion {
  private readonly mounts = new Map<HTMLElement, MountedRows>();

  prepareDismissal(removedKey: string): void {
    for (const [container, mount] of this.mounts) {
      const win = container.ownerDocument.defaultView;
      if (!win || !container.isConnected || !mount.rows.has(removedKey)) continue;
      if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        this.cancel(container, mount);
        continue;
      }
      const top = container.getBoundingClientRect().top;
      const tops = new Map<string, number>();
      for (const [key, row] of mount.rows) {
        if (key === removedKey || row.inert || typeof row.animate !== "function") continue;
        // Leave horizontal entrances and dismissals alone.
        const owned = mount.animations.get(row);
        if (row.getAnimations?.().some((animation) => animation !== owned
          && animation.playState === "running")) continue;
        tops.set(key, row.getBoundingClientRect().top - top);
      }
      const easing = win.getComputedStyle(container).getPropertyValue("--wcm-notification-layout-ease").trim()
        || "cubic-bezier(0.77, 0, 0.175, 1)";
      // Read every current visual position before canceling an interrupted move.
      this.cancel(container, mount);
      mount.pending = { removedKey, tops, easing };
    }
  }

  update(container: HTMLElement, rows: Map<string, HTMLElement>, editor?: EditorView): void {
    let mount = this.mounts.get(container);
    if (!mount) {
      mount = { rows, editor, generation: 0, frame: undefined, animations: new Map(), pending: undefined };
      this.mounts.set(container, mount);
    }
    mount.rows = rows;
    mount.editor = editor;
    mount.generation++;
    const elements = new Set(rows.values());
    for (const [element, animation] of mount.animations) {
      if (!elements.has(element)) {
        animation.cancel();
        mount.animations.delete(element);
      }
    }
    const pending = mount.pending;
    if (!pending || rows.has(pending.removedKey)) return;
    mount.pending = undefined;
    const state = mount;
    const generation = ++state.generation;
    const valid = () => this.mounts.get(container) === state && state.generation === generation && container.isConnected;
    const read = () => {
      if (!valid()) return [];
      const win = container.ownerDocument.defaultView!;
      if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return [];
      const top = container.getBoundingClientRect().top;
      const moves: { element: HTMLElement; delta: number }[] = [];
      for (const [key, oldTop] of pending.tops) {
        const element = state.rows.get(key);
        if (!element?.isConnected || element.inert) continue;
        const delta = oldTop - (element.getBoundingClientRect().top - top);
        if (Math.abs(delta) >= 0.5) moves.push({ element, delta });
      }
      return moves;
    };
    const write = (moves: ReturnType<typeof read>) => {
      if (!valid()) return;
      for (const { element, delta } of moves) {
        if (!element.isConnected || typeof element.animate !== "function") continue;
        const animation = element.animate([
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0px)" },
        ], { duration: 200, easing: pending.easing });
        state.animations.set(element, animation);
        void animation.finished.catch(() => undefined).finally(() => {
          if (state.animations.get(element) !== animation) return;
          state.animations.delete(element);
          animation.cancel();
        });
      }
    };
    if (editor) editor.requestMeasure({ key: state, read, write });
    else {
      state.frame = container.ownerDocument.defaultView!.requestAnimationFrame(() => {
        state.frame = undefined;
        write(read());
      });
    }
  }

  remove(container: HTMLElement): void {
    const mount = this.mounts.get(container);
    if (!mount) return;
    this.cancel(container, mount);
    this.mounts.delete(container);
  }

  destroy(): void {
    for (const container of this.mounts.keys()) this.remove(container);
  }

  private cancel(container: HTMLElement, mount: MountedRows): void {
    mount.generation++;
    mount.pending = undefined;
    if (mount.frame !== undefined) container.ownerDocument.defaultView?.cancelAnimationFrame(mount.frame);
    mount.frame = undefined;
    for (const animation of mount.animations.values()) animation.cancel();
    mount.animations.clear();
  }
}
