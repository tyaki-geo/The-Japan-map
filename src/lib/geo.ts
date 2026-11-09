import type { Geometry, Position } from "geojson";
import type { BBox } from "../types";

function positions(g: Geometry): Position[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "MultiPoint":
    case "LineString":
      return g.coordinates;
    case "MultiLineString":
    case "Polygon":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
    case "GeometryCollection":
      return g.geometries.flatMap(positions);
  }
}

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

export type LngLat = readonly [number, number];

/** 2点間の大円距離 [km] */
export function distanceKm(a: LngLat, b: LngLat): number {
  const R = EARTH_RADIUS_KM;
  const rad = RAD;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** ジオメトリの範囲 [west, south, east, north]。空なら null */
export function geometryBBox(g: Geometry): BBox | null {
  const pts = positions(g);
  if (pts.length === 0) return null;
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    b[0] = Math.min(b[0], x!);
    b[1] = Math.min(b[1], y!);
    b[2] = Math.max(b[2], x!);
    b[3] = Math.max(b[3], y!);
  }
  return b;
}

/** a から b へ向かう初期方位 [度]（北が 0、東が 90。0〜360） */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [lat1, lat2, dLon] = [a[1] * RAD, b[1] * RAD, (b[0] - a[0]) * RAD];
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** a から方位 bearing [度] へ km 進んだ地点（大円に沿う） */
export function destinationPoint(a: LngLat, bearing: number, km: number): [number, number] {
  const [lat1, lon1, brg, d] = [a[1] * RAD, a[0] * RAD, bearing * RAD, km / EARTH_RADIUS_KM];
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  // 経度は -180〜180 に直す
  return [((((lon2 / RAD + 180) % 360) + 360) % 360) - 180, lat2 / RAD];
}

/** 2点を大円（地球の丸みに沿った最短の線）で結ぶ折れ線。steps 本に分ける */
export function greatCircleLine(a: LngLat, b: LngLat, steps = 32): [number, number][] {
  const d = distanceKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return [[a[0], a[1]], [b[0], b[1]]];
  const vec = (p: LngLat) => [
    Math.cos(p[1] * RAD) * Math.cos(p[0] * RAD),
    Math.cos(p[1] * RAD) * Math.sin(p[0] * RAD),
    Math.sin(p[1] * RAD),
  ];
  const [va, vb] = [vec(a), vec(b)];
  const line: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const [ka, kb] = [Math.sin((1 - f) * d) / Math.sin(d), Math.sin(f * d) / Math.sin(d)];
    const [x, y, z] = [0, 1, 2].map((j) => ka * va[j]! + kb * vb[j]!) as [number, number, number];
    line.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  return line;
}
