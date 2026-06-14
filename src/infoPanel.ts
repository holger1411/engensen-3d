import type { BuildingInfo } from "./types";

/** Steuert das HTML-Info-Panel rechts unten. */
export class InfoPanel {
  private el: HTMLElement;
  private body: HTMLElement;

  constructor() {
    this.el = document.getElementById("info-panel")!;
    this.body = document.getElementById("info-body")!;
    document.getElementById("info-close")?.addEventListener("click", () => this.hide());
  }

  show(info: BuildingInfo): void {
    const rows: string[] = [];
    rows.push(`<div class="info-row"><span>Typ</span><b>${esc(info.type)}</b></div>`);
    if (info.levels) rows.push(`<div class="info-row"><span>Stockwerke</span><b>${info.levels}</b></div>`);
    rows.push(`<div class="info-row"><span>Höhe</span><b>${info.height} m</b></div>`);
    if (info.address) rows.push(`<div class="info-row"><span>Adresse</span><b>${esc(info.address)}</b></div>`);
    this.body.innerHTML = `<h2>${esc(info.name)}</h2>${rows.join("")}`;
    this.el.classList.add("visible");
  }

  hide(): void {
    this.el.classList.remove("visible");
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
