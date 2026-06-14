import * as THREE from "three";
import { Projection } from "./geo";
import type { FeatureCollection, GeoFeature } from "./types";
import type { TerrainSampler } from "./terrain";

/**
 * POIs (Geschäfte & wichtige Punkte) aus OpenStreetMap als beschriftete Marker.
 * Jeder POI ist ein Schild (Emoji + Name) auf einem dünnen Mast, auf dem Gelände.
 */

function iconFor(cat: string, value: string): string {
  const v = value || "";
  if (cat === "shop") {
    const m: Record<string, string> = {
      bakery: "🥖", supermarket: "🛒", convenience: "🏪", butcher: "🥩", hairdresser: "💈",
      kiosk: "🏪", wine: "🍷", alcohol: "🍷", florist: "🌷", car: "🚗", car_repair: "🔧",
      clothes: "👕", greengrocer: "🥬", farm: "🧺", deli: "🧀", beverages: "🥤",
    };
    return m[v] || "🛍️";
  }
  if (cat === "amenity") {
    const m: Record<string, string> = {
      place_of_worship: "⛪", school: "🏫", kindergarten: "🧸", restaurant: "🍽️", cafe: "☕",
      pub: "🍺", bar: "🍸", biergarten: "🍺", fast_food: "🍔", bank: "🏦", pharmacy: "💊", fuel: "⛽",
      fire_station: "🚒", doctors: "🩺", dentist: "🦷", post_office: "📮", townhall: "🏛️",
      community_centre: "🏛️", library: "📚", veterinary: "🐾",
    };
    return m[v] || "📍";
  }
  if (cat === "tourism") {
    const m: Record<string, string> = {
      hotel: "🏨", guest_house: "🛏️", museum: "🏛️", artwork: "🎨", attraction: "⭐",
      viewpoint: "🔭", information: "ℹ️", picnic_site: "🧺",
    };
    return m[v] || "📷";
  }
  if (cat === "leisure") {
    const m: Record<string, string> = { sports_centre: "⚽", pitch: "⚽", playground: "🛝", park: "🌳", stadium: "🏟️" };
    return m[v] || "🎯";
  }
  if (cat === "craft") return "🔧";
  if (cat === "office") return "🏢";
  if (cat === "healthcare") return "🩺";
  if (cat === "historic") return v === "windmill" ? "🌬️" : "🏛️";
  return "📍";
}

function makeSign(icon: string, name: string): THREE.Sprite {
  const label = name ? `${icon} ${name}` : icon;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "30px -apple-system, Arial, sans-serif";
  ctx.font = font;
  const pad = 16;
  const w = Math.ceil(ctx.measureText(label).width) + pad * 2;
  const h = 46;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.font = font;
  c.fillStyle = "rgba(16,20,27,0.86)";
  roundRect(c, 0, 0, w, h, 12);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = 1.5;
  roundRect(c, 0.75, 0.75, w - 1.5, h - 1.5, 12);
  c.stroke();
  c.fillStyle = "#ffffff";
  c.textBaseline = "middle";
  c.fillText(label, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
  const scale = 0.42;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const POLE_H = 15; // Masthöhe über Boden

export function buildPois(fc: FeatureCollection, proj: Projection, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  group.name = "pois";

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.8 });
  const poleGeom = new THREE.CylinderGeometry(0.25, 0.25, POLE_H, 5);

  for (const f of fc.features as GeoFeature[]) {
    if (f.geometry.type !== "Point") continue;
    const coord = f.geometry.coordinates as unknown as number[];
    const p = proj.project(coord[0], coord[1]);
    const base = terrain.sample(p.x, -p.y);
    const cat = (f.properties.cat as string) || "";
    const value = (f.properties.value as string) || "";
    const name = (f.properties.name as string) || "";

    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.set(p.x, base + POLE_H / 2, -p.y);
    group.add(pole);

    const sign = makeSign(iconFor(cat, value), name);
    sign.position.set(p.x, base + POLE_H + 4, -p.y);
    group.add(sign);
  }

  return group;
}
