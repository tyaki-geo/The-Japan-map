// data/raw の基盤地図情報（FG-GML zip）を都道府県・市区町村単位に整理して data/edited へ出力する
//
// 入力: data/raw/**/FG-GML-{メッシュ}-{項目}-{日付}.zip
//   05 行政区画 : AdmArea（2次メッシュで分割された市区町村ポリゴン）
//   12 町字界   : CommBdry（町字界線）, CommPt（大字・町・丁目の代表点）
// 出力: data/README.md を参照
//
// 町字界は線と代表点しかないため、線と市区町村界から区域を組み立て、代表点の名称で
// 「丁目」を除いたまとまり（町・大字）ごとに統合する
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import mapshaper from "mapshaper";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon, Position } from "geojson";
import { parseArchiveName, parseFgdXml, type FgdArchiveName } from "./lib/fgd";
import { prefectureName } from "./lib/prefectures";
import { pickGroupName } from "./lib/towns";
import type {
  BBox,
  DatasetIndex,
  MunicipalityEntry,
  MunicipalityProps,
  PrefectureEntry,
  TownProps,
} from "../src/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw");
const outDir = path.join(root, "data", "edited");

const SUPPORTED_ITEMS: Record<string, string> = { "05": "行政区画", "12": "町字界" };
const TOWN_BOUNDARY_TYPE = "大字・町・丁目界";

type Archive = FgdArchiveName & { file: string };
type MuniFeature = Feature<Polygon | MultiPolygon, MunicipalityProps>;
type TownLine = Feature<LineString, { type: string }>;
type TownPoint = Feature<Point, { name: string }>;

async function findArchives(dir: string): Promise<Archive[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  // 同じメッシュ・項目が複数あれば日付の新しいものを採用
  const latest = new Map<string, Archive>();
  for (const e of entries) {
    if (!e.isFile()) continue;
    const parsed = parseArchiveName(e.name);
    if (!parsed) continue;
    if (!SUPPORTED_ITEMS[parsed.item]) {
      console.warn(`skip (未対応の項目 ${parsed.item}): ${e.name}`);
      continue;
    }
    const key = `${parsed.mesh}-${parsed.item}`;
    const prev = latest.get(key);
    if (!prev || prev.date < parsed.date) {
      latest.set(key, { ...parsed, file: path.join(e.parentPath, e.name) });
    }
  }
  return [...latest.values()].sort((a, b) => a.file.localeCompare(b.file));
}

async function readArchive(file: string) {
  const files = unzipSync(new Uint8Array(await readFile(file)), {
    filter: (f) => f.name.startsWith("FG-GML-") && f.name.endsWith(".xml"),
  });
  return Object.values(files).flatMap((data) => parseFgdXml(strFromU8(data)));
}

function computeBBox(coords: Position[]): BBox {
  const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    bbox[0] = Math.min(bbox[0], x!);
    bbox[1] = Math.min(bbox[1], y!);
    bbox[2] = Math.max(bbox[2], x!);
    bbox[3] = Math.max(bbox[3], y!);
  }
  return bbox;
}

function polygonPositions(geom: Polygon | MultiPolygon): Position[] {
  return geom.type === "Polygon" ? geom.coordinates.flat() : geom.coordinates.flat(2);
}

function mergeBBox(boxes: BBox[]): BBox {
  return computeBBox(boxes.flatMap((b) => [[b[0], b[1]], [b[2], b[3]]]));
}

function inBBox([x, y]: Position, b: BBox): boolean {
  return x! >= b[0] && x! <= b[2] && y! >= b[1] && y! <= b[3];
}

// 小数6桁 ≒ 0.1m
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const roundPosition = (p: Position): Position => [round6(p[0]!), round6(p[1]!)];

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

function featureCollection<F extends Feature>(features: F[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

/**
 * 町字界線と市区町村界から区域を作り、代表点の名称（丁目を除く）で統合する。
 * 代表点を含まない区域（町字データの無い範囲や境界のずれによる細片）は捨てる。
 */
async function buildTownAreas(boundary: MuniFeature, lines: TownLine[], points: TownPoint[]) {
  const polygonized = await mapshaper.applyCommands(
    [
      "-i lines.json boundary.json combine-files",
      "-lines target=boundary",
      "-merge-layers target=lines,boundary force name=net",
      "-polygons",
      "-clip boundary.json",
      "-explode",
      "-o areas.json format=geojson geojson-type=FeatureCollection precision=0.000001",
    ].join(" "),
    {
      "lines.json": JSON.stringify(featureCollection(lines)),
      "boundary.json": JSON.stringify(featureCollection([boundary])),
    },
  );
  const areas = (JSON.parse(String(polygonized["areas.json"])) as FeatureCollection<Polygon>).features;

  const named: Feature<Polygon, { name: string; count: number }>[] = [];
  for (const area of areas) {
    if (!area.geometry) continue; // クリップで空になった区域
    const bbox = computeBBox(area.geometry.coordinates.flat());
    const names = points
      .filter((p) => inBBox(p.geometry.coordinates, bbox) && booleanPointInPolygon(p.geometry, area.geometry))
      .map((p) => p.properties.name);
    const name = pickGroupName(names);
    if (name) named.push({ type: "Feature", properties: { name, count: names.length }, geometry: area.geometry });
  }
  if (named.length === 0) return [];

  const grouped = await mapshaper.applyCommands(
    [
      "-i areas.json name=areas",
      "-dissolve fields=name sum-fields=count name=areas",
      "-o grouped.json format=geojson precision=0.000001",
      "-points inner + name=labels target=areas",
      "-o labels.json target=labels format=geojson precision=0.000001",
    ].join(" "),
    { "areas.json": JSON.stringify(featureCollection(named)) },
  );
  const parse = (name: string) =>
    (JSON.parse(String(grouped[name])) as FeatureCollection<Polygon | MultiPolygon | Point, { name: string; count: number }>)
      .features;

  const result: Feature<Polygon | MultiPolygon | Point, TownProps>[] = [
    ...parse("grouped.json").map((f) => ({
      ...f,
      properties: { kind: "area" as const, name: f.properties.name, count: f.properties.count },
    })),
    ...parse("labels.json").map((f) => ({ ...f, properties: { kind: "label" as const, name: f.properties.name } })),
  ];
  return result;
}

// ---- 読み込み ----
const archives = await findArchives(rawDir);
if (archives.length === 0) {
  console.error(`no FG-GML archives found in ${rawDir}`);
  process.exit(1);
}

const pieces: MuniFeature[] = [];
const townLines: TownLine[] = [];
const townPoints: { feature: TownPoint; admCode?: string }[] = [];

for (const archive of archives) {
  for (const f of await readArchive(archive.file)) {
    if (f.kind === "AdmArea" && f.admCode && f.geometry.type !== "Point") {
      const prefCode = f.admCode.slice(0, 2);
      pieces.push({
        type: "Feature",
        properties: {
          code: f.admCode,
          name: f.name ?? "",
          type: f.type,
          prefCode,
          prefName: prefectureName(prefCode),
        },
        geometry: f.geometry as Polygon | MultiPolygon,
      });
    } else if (f.kind === "CommBdry" && f.type === TOWN_BOUNDARY_TYPE && f.geometry.type === "LineString") {
      townLines.push({
        type: "Feature",
        properties: { type: f.type },
        geometry: { type: "LineString", coordinates: f.geometry.coordinates.map(roundPosition) },
      });
    } else if (f.kind === "CommPt" && f.geometry.type === "Point") {
      townPoints.push({
        feature: {
          type: "Feature",
          properties: { name: f.name ?? "" },
          geometry: { type: "Point", coordinates: roundPosition(f.geometry.coordinates) },
        },
        admCode: f.admCode,
      });
    }
  }
}
console.log(
  `archives: ${archives.length}, 行政区画ポリゴン片: ${pieces.length}, 町字界線: ${townLines.length}, 町字代表点: ${townPoints.length}`,
);

// ---- メッシュ単位のポリゴンを市区町村ごとに統合し、全体表示用に簡略化 ----
const shp = await mapshaper.applyCommands(
  [
    "-i pieces.json name=munis",
    "-dissolve code copy-fields=name,type,prefCode,prefName",
    "-each 'areaKm2=Math.round(this.area/1e4)/100'",
    "-o detail.json format=geojson precision=0.000001",
    "-points inner + name=centers target=munis",
    "-o centers.json target=centers format=geojson precision=0.000001",
    // 隣接する市区町村の境界がずれないよう、トポロジーを保ったまま簡略化する
    "-simplify interval=30 keep-shapes target=munis",
    "-filter-fields code,name,type,prefCode,prefName target=munis",
    "-o municipalities.json target=munis format=geojson precision=0.00001",
    "-dissolve prefCode copy-fields=prefName + name=prefs target=munis",
    "-o prefectures.json target=prefs format=geojson precision=0.00001",
  ].join(" "),
  { "pieces.json": JSON.stringify(featureCollection(pieces)) },
);
const parseOut = <T>(name: string) => JSON.parse(String(shp[name])) as T;

const detail = parseOut<FeatureCollection<Polygon | MultiPolygon, MunicipalityProps & { areaKm2: number }>>(
  "detail.json",
);
const centers = new Map(
  parseOut<FeatureCollection<Point, MunicipalityProps>>("centers.json").features.map((f) => [
    f.properties.code,
    f.geometry.coordinates,
  ]),
);

// ---- 町字界を市区町村に振り分ける ----
const munis = detail.features.map((f) => ({ feature: f, bbox: computeBBox(polygonPositions(f.geometry)) }));

function findMunicipality(pos: Position): string | undefined {
  return munis.find((m) => inBBox(pos, m.bbox) && booleanPointInPolygon(pos, m.feature.geometry))?.feature
    .properties.code;
}

const townsByMuni = new Map<string, { lines: TownLine[]; points: TownPoint[] }>();
const addTown = (code: string | undefined, f: TownLine | TownPoint) => {
  if (!code) return false;
  const towns = townsByMuni.get(code) ?? { lines: [], points: [] };
  if (f.geometry.type === "Point") towns.points.push(f as TownPoint);
  else towns.lines.push(f as TownLine);
  townsByMuni.set(code, towns);
  return true;
};

const knownCodes = new Set(munis.map((m) => m.feature.properties.code));
let unassigned = 0;
const endpointKey = (p: Position) => `${p[0]},${p[1]}`;
const codeByEndpoint = new Map<string, string>();
let pendingLines: TownLine[] = [];
for (const line of townLines) {
  // 中央の頂点から順に、市区町村ポリゴン内にある頂点で判定する（海岸沿いの線への対策）
  const coords = line.geometry.coordinates;
  const mid = Math.floor(coords.length / 2);
  const ordered = [...coords.slice(mid), ...coords.slice(0, mid).reverse()];
  let code: string | undefined;
  for (const pos of ordered) if ((code = findMunicipality(pos))) break;
  if (addTown(code, line)) {
    for (const p of [coords[0]!, coords[coords.length - 1]!]) codeByEndpoint.set(endpointKey(p), code!);
  } else {
    pendingLines.push(line);
  }
}
// 湾内など行政区画ポリゴン（陸域）の外にある線は、端点でつながる振り分け済みの線に合わせる
for (let changed = true; changed && pendingLines.length > 0; ) {
  changed = false;
  pendingLines = pendingLines.filter((line) => {
    const coords = line.geometry.coordinates;
    const ends = [coords[0]!, coords[coords.length - 1]!].map(endpointKey);
    const code = ends.map((k) => codeByEndpoint.get(k)).find(Boolean);
    if (!addTown(code, line)) return true;
    for (const k of ends) codeByEndpoint.set(k, code!);
    changed = true;
    return false;
  });
}
unassigned += pendingLines.length;
for (const { feature, admCode } of townPoints) {
  // admCode が 00000 などの場合は位置から判定する
  const code = admCode && knownCodes.has(admCode) ? admCode : findMunicipality(feature.geometry.coordinates);
  if (!addTown(code, feature)) unassigned++;
}
if (unassigned > 0) console.warn(`市区町村に振り分けられなかった町字データ: ${unassigned}`);

// ---- 出力 ----
await rm(path.join(outDir, "prefectures"), { recursive: true, force: true });

const prefectures = new Map<string, PrefectureEntry>();
let townGroupTotal = 0;
for (const { feature, bbox } of munis) {
  const { areaKm2, ...props } = feature.properties;
  const muni: MuniFeature = { ...feature, properties: props };
  const dir = `prefectures/${props.prefCode}/${props.code}`;
  const source = townsByMuni.get(props.code);
  const towns = source ? await buildTownAreas(muni, source.lines, source.points) : [];
  const townCount = towns.filter((t) => t.properties.kind === "area").length;
  townGroupTotal += townCount;
  const center = centers.get(props.code) ?? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

  await writeJson(path.join(outDir, dir, "boundary.geojson"), featureCollection([muni]));
  if (towns.length > 0) await writeJson(path.join(outDir, dir, "towns.geojson"), featureCollection(towns));

  const entry: MunicipalityEntry = {
    code: props.code,
    name: props.name,
    type: props.type,
    areaKm2,
    bbox: bbox.map(round6) as BBox,
    center: [round6(center[0]!), round6(center[1]!)],
    hasTowns: townCount > 0,
    townCount,
    dir,
  };
  const pref = prefectures.get(props.prefCode) ?? {
    code: props.prefCode,
    name: props.prefName,
    bbox: entry.bbox,
    municipalities: [],
  };
  pref.municipalities.push(entry);
  prefectures.set(props.prefCode, pref);
}

const prefList = [...prefectures.values()].sort((a, b) => a.code.localeCompare(b.code));
for (const pref of prefList) {
  pref.municipalities.sort((a, b) => a.code.localeCompare(b.code));
  pref.bbox = mergeBBox(pref.municipalities.map((m) => m.bbox));
}

const itemCounts: Record<string, number> = {};
for (const a of archives) itemCounts[a.item] = (itemCounts[a.item] ?? 0) + 1;

const index: DatasetIndex = {
  generatedAt: new Date().toISOString(),
  source: {
    name: "基盤地図情報 基本項目（国土地理院）",
    url: "https://service.gsi.go.jp/kiban/",
    meshes: [...new Set(archives.map((a) => a.mesh))].sort(),
    items: itemCounts,
  },
  prefectures: prefList,
};

await writeJson(path.join(outDir, "index.json"), index);
await writeFile(path.join(outDir, "municipalities.geojson"), String(shp["municipalities.json"]));
await writeFile(path.join(outDir, "prefectures.geojson"), String(shp["prefectures.json"]));

console.log(
  `wrote ${outDir}: 都道府県 ${prefList.length}, 市区町村 ${munis.length}, 町・大字 ${townGroupTotal}（町字データあり ${townsByMuni.size} 市区町村）`,
);
