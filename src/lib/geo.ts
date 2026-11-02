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

/** 2点間の大円距離 [km] */
export function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371;
  const rad = Math.PI / 180;
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
