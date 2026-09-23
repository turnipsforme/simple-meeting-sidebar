/** Refresh feedback takes no layout space: announce it and pulse the handle. */
export class RefreshStatus {
  readonly element: HTMLElement;
  private refreshing: boolean | undefined;
  private pulse: Animation | undefined;

  constructor(container: HTMLElement, private readonly indicator?: HTMLElement) {
    this.element = container.createDiv({ cls: "wcm-status-announcement", attr: { role: "status", "aria-atomic": "true" } });
  }

  update(refreshing: boolean, animate: boolean): void {
    if (refreshing === this.refreshing) return;
    const firstRender = this.refreshing === undefined;
    this.refreshing = refreshing;
    this.element.textContent = refreshing ? "Refreshing calendars…" : "";
    this.indicator?.classList.toggle("is-refreshing", refreshing);
    if (!refreshing) return;
    this.pulse?.cancel();
    this.pulse = undefined;
    const win = this.indicator?.ownerDocument.defaultView;
    if (firstRender || !animate || !this.indicator?.isConnected || !win
      || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      || typeof this.indicator.animate !== "function") return;
    // Three gentle pulses, under two cycles a second. Let a fast refresh finish
    // its feedback without holding up the operation or moving the meeting list.
    const pulse = this.indicator.animate([
      { opacity: 0.45 }, { opacity: 1 }, { opacity: 0.45 },
    ], { duration: 600, iterations: 3, easing: "cubic-bezier(0.77, 0, 0.175, 1)" });
    this.pulse = pulse;
    void pulse.finished.catch(() => undefined).finally(() => {
      if (this.pulse !== pulse) return;
      pulse.cancel();
      this.pulse = undefined;
    });
  }

  dispose(): void {
    this.pulse?.cancel();
    this.pulse = undefined;
    this.indicator?.classList.remove("is-refreshing");
  }
}
