// 基盤地図情報（FG-GML）の XML を GeoJSON 互換の地物に変換する
import { XMLParser } from "fast-xml-parser";
import type { Geometry, Position } from "geojson";

export interface FgdFeature {
  /** 要素名（AdmArea, CommPt など） */
  kind: string;
  fid: string;
  type: string;
  name?: string;
  admCode?: string;
  geometry: Geometry;
}

/** zip 名 FG-GML-{2次メッシュ}-{項目番号}-{日付}.zip */
export interface FgdArchiveName {
  mesh: string;
  item: string;
  date: string;
}

export function parseArchiveName(fileName: string): FgdArchiveName | null {
  const m = /^FG-GML-(\d{6})-(\d{2})-(\d{8})\.zip$/.exec(fileName);
  return m ? { mesh: m[1]!, item: m[2]!, date: m[3]! } : null;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  // 1件しかない場合も配列として扱う
  isArray: (name) => ["curveMember", "interior", "PolygonPatch", "LineStringSegment"].includes(name),
});

type Node = Record<string, unknown>;

// FG-GML の座標は「緯度 経度」順なので GeoJSON の [経度, 緯度] に入れ替える
function parsePosList(text: string): Position[] {
  const nums = text.trim().split(/\s+/).map(Number);
  const out: Position[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i + 1]!, nums[i]!]);
  return out;
}

function curveCoords(curve: Node): Position[] {
  const segments = (curve.segments as Node).LineStringSegment as Node[];
  const coords: Position[] = [];
  for (const seg of segments) {
    const pts = parsePosList(String(seg.posList));
    // 連続するセグメントの継ぎ目は同一点なので重複させない
    const last = coords[coords.length - 1];
    const first = pts[0];
    if (last && first && last[0] === first[0] && last[1] === first[1]) pts.shift();
    coords.push(...pts);
  }
  return coords;
}

function ringCoords(ring: Node): Position[] {
  const coords: Position[] = [];
  for (const member of ring.curveMember as Node[]) {
    const pts = curveCoords(member.Curve as Node);
    const last = coords[coords.length - 1];
    const first = pts[0];
    if (last && first && last[0] === first[0] && last[1] === first[1]) pts.shift();
    coords.push(...pts);
  }
  return coords;
}

function surfaceToPolygon(surface: Node): Geometry {
  const patches = (surface.patches as Node).PolygonPatch as Node[];
  const polygons = patches.map((patch) => {
    const rings = [ringCoords((patch.exterior as Node).Ring as Node)];
    for (const interior of (patch.interior as Node[] | undefined) ?? []) {
      rings.push(ringCoords(interior.Ring as Node));
    }
    return rings;
  });
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0]! }
    : { type: "MultiPolygon", coordinates: polygons };
}

function toGeometry(geomContainer: Node): Geometry | null {
  if (geomContainer.Surface) return surfaceToPolygon(geomContainer.Surface as Node);
  if (geomContainer.Curve) {
    return { type: "LineString", coordinates: curveCoords(geomContainer.Curve as Node) };
  }
  if (geomContainer.Point) {
    const [pos] = parsePosList(String((geomContainer.Point as Node).pos));
    return pos ? { type: "Point", coordinates: pos } : null;
  }
  return null;
}

// 地物ごとのジオメトリを持つプロパティ名
const GEOMETRY_KEYS = ["area", "loc", "pos"];

export function parseFgdXml(xml: string): FgdFeature[] {
  const dataset = (parser.parse(xml) as Node).Dataset as Node | undefined;
  if (!dataset) return [];

  const features: FgdFeature[] = [];
  for (const [kind, value] of Object.entries(dataset)) {
    if (kind === "description" || kind === "name") continue;
    const items = (Array.isArray(value) ? value : [value]) as Node[];
    for (const item of items) {
      const geomKey = GEOMETRY_KEYS.find((k) => item[k] !== undefined);
      const geometry = geomKey ? toGeometry(item[geomKey] as Node) : null;
      if (!geometry) continue;
      features.push({
        kind,
        fid: String(item.fid),
        type: String(item.type ?? ""),
        name: item.name !== undefined ? String(item.name) : undefined,
        admCode: item.admCode !== undefined ? String(item.admCode) : undefined,
        geometry,
      });
    }
  }
  return features;
}
