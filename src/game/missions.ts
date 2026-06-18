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
  { id: "thoense", name: "Thönse", lat: 52.4936, lon: 9.902, pop: 980, horde: 620, speedMul: 1.04, drainMul: 1.03 },
  { id: "lahberg", name: "Lahberg", lat: 52.5132842, lon: 9.9528683, pop: 430, horde: 560, speedMul: 1.07, drainMul: 1.05 },
  { id: "wettmar", name: "Wettmar", lat: 52.5121407, lon: 9.9192944, pop: 3371, horde: 850, speedMul: 1.08, drainMul: 1.0 },
  { id: "oldhorst", name: "Oldhorst", lat: 52.4779, lon: 9.9155, pop: 200, horde: 460, speedMul: 1.13, drainMul: 1.12 },
];
