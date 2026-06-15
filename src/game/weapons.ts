// src/game/weapons.ts
export type WeaponId = "gatling" | "bofors" | "howitzer";

export interface WeaponSpec {
  id: WeaponId;
  name: string; // HUD-Kurzlabel, z.B. "25mm"
  fullName: string;
  maxAmmo: number;
  fireIntervalSec: number; // Kehrwert der Feuerrate
  muzzleVel: number; // m/s (Welt = Meter)
  damage: number;
  splashRadius: number; // m (horizontal)
  spreadRad: number; // Streuung (Halbwinkel)
  tracerColor: number;
}

// Echte AC-130U-Werte (Feuerrate als Intervall, Vorrat fix)
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  gatling: {
    id: "gatling", name: "25mm", fullName: "25 mm GAU-12 Gatling",
    maxAmmo: 3000, fireIntervalSec: 1 / 30, muzzleVel: 1040,
    damage: 40, splashRadius: 0, spreadRad: 0.009, tracerColor: 0xffffff,
  },
  bofors: {
    id: "bofors", name: "40mm", fullName: "40 mm Bofors L/60",
    maxAmmo: 256, fireIntervalSec: 1 / 1.7, muzzleVel: 880,
    damage: 130, splashRadius: 9, spreadRad: 0.004, tracerColor: 0xffffff,
  },
  howitzer: {
    id: "howitzer", name: "105mm", fullName: "105 mm M102 Haubitze",
    maxAmmo: 100, fireIntervalSec: 7, muzzleVel: 494,
    damage: 600, splashRadius: 32, spreadRad: 0.002, tracerColor: 0xffffff,
  },
};

export const WEAPON_ORDER: WeaponId[] = ["gatling", "bofors", "howitzer"];

export class Arsenal {
  active: WeaponId = "gatling";
  private ammo: Record<WeaponId, number>;
  private lastShot: Record<WeaponId, number> = { gatling: -999, bofors: -999, howitzer: -999 };

  constructor() {
    this.ammo = { gatling: WEAPONS.gatling.maxAmmo, bofors: WEAPONS.bofors.maxAmmo, howitzer: WEAPONS.howitzer.maxAmmo };
  }

  spec(): WeaponSpec { return WEAPONS[this.active]; }
  ammoOf(id: WeaponId): number { return this.ammo[id]; }
  lastShotOf(id: WeaponId): number { return this.lastShot[id]; }
  switchTo(id: WeaponId): void { this.active = id; }

  canFire(now: number): boolean {
    return this.ammo[this.active] > 0 && now - this.lastShot[this.active] >= WEAPONS[this.active].fireIntervalSec;
  }

  fire(now: number): boolean {
    if (!this.canFire(now)) return false;
    this.ammo[this.active] -= 1;
    this.lastShot[this.active] = now;
    return true;
  }

  allEmpty(): boolean {
    return WEAPON_ORDER.every((id) => this.ammo[id] <= 0);
  }
}
