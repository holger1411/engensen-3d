/** Missionen: zu verteidigende Orte mit eigener Bevölkerung & Schwierigkeit. */
export interface Mission {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pop: number; // Einwohner (Lebenspunkte)
  horde: number; // Gesamtzahl Zombies
  speedMul: number; // Zombie-Tempo-Faktor
  drainMul: number; // Bevölkerungs-Schwund-Faktor
}

// Reihenfolge = ansteigende Schwierigkeit.
export const MISSIONS: Mission[] = [
  { id: "engensen", name: "Engensen", lat: 52.5003028, lon: 9.9442798, pop: 1500, horde: 600, speedMul: 1.0, drainMul: 1.0 },
  { id: "lahberg", name: "Lahberg", lat: 52.5132842, lon: 9.9528683, pop: 280, horde: 550, speedMul: 1.18, drainMul: 1.15 },
  { id: "wettmar", name: "Wettmar", lat: 52.5121407, lon: 9.9192944, pop: 3371, horde: 1150, speedMul: 1.32, drainMul: 1.0 },
];
