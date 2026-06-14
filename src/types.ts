export interface GeoFeature {
  type: "Feature";
  properties: Record<string, string | undefined>;
  geometry: {
    type: "Polygon" | "LineString" | "Point";
    coordinates: number[] | number[][] | number[][][];
  };
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface Meta {
  center: { lat: number; lon: number };
  bbox: { south: number; west: number; north: number; east: number };
  radius_m: number;
  source: string;
  counts: { buildings: number; roads: number; areas: number };
}

/** Aufbereitete Eigenschaften, die im Info-Panel angezeigt werden. */
export interface BuildingInfo {
  name: string;
  type: string;
  levels?: number;
  height: number;
  address?: string;
}
