// src/game/weapons.test.ts
import { describe, it, expect } from "vitest";
import { Arsenal, WEAPONS } from "./weapons";

describe("Arsenal", () => {
  it("startet mit echtem Munitionsvorrat", () => {
    const a = new Arsenal();
    expect(a.ammoOf("gatling")).toBe(3000);
    expect(a.ammoOf("bofors")).toBe(256);
    expect(a.ammoOf("howitzer")).toBe(100);
    expect(a.active).toBe("gatling");
  });

  it("feuern verbraucht Munition und erzwingt Feuerrate-Cooldown", () => {
    const a = new Arsenal();
    expect(a.fire(0)).toBe(true);
    expect(a.ammoOf("gatling")).toBe(2999);
    // sofortiges Nachfeuern blockiert (30/s → 0.0333s Intervall)
    expect(a.canFire(0.01)).toBe(false);
    expect(a.fire(0.01)).toBe(false);
    // nach Intervall wieder möglich
    expect(a.canFire(0.04)).toBe(true);
    expect(a.fire(0.04)).toBe(true);
    expect(a.ammoOf("gatling")).toBe(2998);
  });

  it("wechselt Waffe und meldet leeren Gesamtvorrat", () => {
    const a = new Arsenal();
    a.switchTo("howitzer");
    expect(a.active).toBe("howitzer");
    expect(a.spec().splashRadius).toBe(WEAPONS.howitzer.splashRadius);
    expect(a.allEmpty()).toBe(false);
  });

  it("canFire ist false bei leerer Munition", () => {
    const a = new Arsenal();
    // howitzer leeren
    let t = 0;
    for (let i = 0; i < 100; i++) { a.switchTo("howitzer"); a.fire(t); t += 10; }
    expect(a.ammoOf("howitzer")).toBe(0);
    expect(a.canFire(t + 10)).toBe(false);
  });
});
