import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// バンドル後は maplibre-gl.mjs の隣に worker が置かれないため、Vite で配信した URL を明示する
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Feature, FeatureCollection } from "geojson";
import { dataUrl } from "./lib/data";
import type { BBox, DatasetIndex, MunicipalityEntry } from "./types";

maplibregl.setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// 都道府県ごとの塗り色（index.json の並び順に割り当て）
const PREF_COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#e15759", "#76b7b2", "#edc948", "#9c755f"];

export const LAYER_GROUPS = {
  municipalities: ["muni-fill", "muni-line", "pref-line", "selected-line"],
  towns: ["towns-fill", "towns-line"],
  labels: ["muni-label", "towns-label"],
} as const;
export type LayerGroup = keyof typeof LAYER_GROUPS;

/** クイズで地図に示す対象 */
export interface QuizTarget {
  /** 強調する区域（市区町村または町・大字） */
  feature: Feature;
  bbox: BBox;
  /** 町・大字の問題で、その市区町村の町・大字を線で示す */
  towns?: FeatureCollection;
  /** 町・大字の問題で、その市区町村の境界 */
  municipality?: MunicipalityEntry;
}

export interface JapanMap {
  map: maplibregl.Map;
  select(m: MunicipalityEntry | null, opts?: { fit?: boolean }): void;
  setGroupVisible(group: LayerGroup, visible: boolean): void;
  fitBBox(bbox: BBox): void;
  /** クイズ中はラベル・名前のホバー表示・クリック選択を止め、クリックを回答として渡す */
  setQuizMode(on: boolean, onAnswer?: (answer: QuizAnswer) => void): void;
  /** 答え合わせで正解の区域を強調して映す（null で消す） */
  showQuizTarget(target: QuizTarget | null): void;
  /** クリックした位置に印を付ける（null で消す） */
  markAnswer(lngLat: [number, number] | null): void;
  /** 答え合わせの後に名前のラベルを出す */
  revealLabels(on: boolean): void;
}

/** クイズでクリックされた市区町村と位置 */
export interface QuizAnswer {
  code: string;
  name: string;
  prefName: string;
  lngLat: [number, number];
}

export function createMap(
  container: HTMLElement,
  index: DatasetIndex,
  onSelect: (code: string | null) => void,
): Promise<JapanMap> {
  const allBBox = index.prefectures.map((p) => p.bbox);
  const bounds: BBox = [
    Math.min(...allBBox.map((b) => b[0])),
    Math.min(...allBBox.map((b) => b[1])),
    Math.max(...allBBox.map((b) => b[2])),
    Math.max(...allBBox.map((b) => b[3])),
  ];

  const colorByPref = Object.fromEntries(
    index.prefectures.map((p, i) => [p.code, PREF_COLORS[i % PREF_COLORS.length]!]),
  );
  const prefColor: maplibregl.ExpressionSpecification = [
    "coalesce",
    ["get", ["get", "prefCode"], ["literal", colorByPref]],
    "#888888",
  ];

  const labelPoints: FeatureCollection = {
    type: "FeatureCollection",
    features: index.prefectures.flatMap((p) =>
      p.municipalities.map((m) => ({
        type: "Feature" as const,
        properties: { code: m.code, name: m.name },
        geometry: { type: "Point" as const, coordinates: m.center },
      })),
    ),
  };

  const map = new maplibregl.Map({
    container,
    bounds,
    attributionControl: { compact: true },
    fitBoundsOptions: { padding: 24 },
    style: {
      version: 8,
      sources: {
        prefectures: {
          type: "geojson",
          data: dataUrl("prefectures.geojson"),
          attribution: "基盤地図情報（国土地理院）を加工して作成",
        },
        municipalities: { type: "geojson", data: dataUrl("municipalities.geojson"), promoteId: "code" },
        "muni-labels": { type: "geojson", data: labelPoints },
        selected: { type: "geojson", data: EMPTY },
        towns: { type: "geojson", data: EMPTY, generateId: true },
        "quiz-target": { type: "geojson", data: EMPTY },
      },
      layers: [
        // 背景地図は使わず、陸地（市区町村の塗り）以外を海の色にする
        { id: "background", type: "background", paint: { "background-color": "#eef3f8" } },
        {
          id: "muni-fill",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": prefColor,
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.35,
              ["boolean", ["feature-state", "hover"], false],
              0.4,
              0.18,
            ],
          },
        },
        {
          id: "muni-line",
          type: "line",
          source: "municipalities",
          paint: { "line-color": "#555", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.4, 12, 1.2] },
        },
        {
          id: "pref-line",
          type: "line",
          source: "prefectures",
          paint: { "line-color": "#222", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.2, 12, 3] },
        },
        {
          // 透明の塗りで町・大字のホバー判定とハイライトを行う
          id: "towns-fill",
          type: "fill",
          source: "towns",
          filter: ["==", ["get", "kind"], "area"],
          paint: {
            "fill-color": "#c0392b",
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.2, 0],
          },
        },
        {
          id: "towns-line",
          type: "line",
          source: "towns",
          filter: ["==", ["get", "kind"], "area"],
          paint: { "line-color": "#c0392b", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.5] },
        },
        {
          id: "quiz-target-fill",
          type: "fill",
          source: "quiz-target",
          paint: { "fill-color": "#d35400", "fill-opacity": 0.45 },
        },
        {
          id: "selected-line",
          type: "line",
          source: "selected",
          paint: { "line-color": "#d35400", "line-width": 3 },
        },
        {
          id: "quiz-target-line",
          type: "line",
          source: "quiz-target",
          paint: { "line-color": "#a04000", "line-width": 3 },
        },
        {
          id: "towns-label",
          type: "symbol",
          source: "towns",
          minzoom: 11,
          filter: ["==", ["get", "kind"], "label"],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["sans-serif"],
            "text-size": 12,
          },
          paint: { "text-color": "#7b241c", "text-halo-color": "#fff", "text-halo-width": 1.5 },
        },
        {
          id: "muni-label",
          type: "symbol",
          source: "muni-labels",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["sans-serif"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 16],
          },
          paint: { "text-color": "#222", "text-halo-color": "#fff", "text-halo-width": 2 },
        },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  let hovered: string | null = null;
  let hoveredTown: string | number | null = null;
  let selected: string | null = null;
  let quiz = false;
  let onQuizAnswer: ((answer: QuizAnswer) => void) | undefined;
  let answerMarker: maplibregl.Marker | null = null;
  let labelsRevealed = false;
  const groupVisible: Record<LayerGroup, boolean> = { municipalities: true, towns: true, labels: true };

  const applyVisibility = () => {
    for (const [group, ids] of Object.entries(LAYER_GROUPS) as [LayerGroup, readonly string[]][]) {
      // クイズ中は答えが分かってしまうラベルを、答え合わせまで隠す
      const visible = quiz ? group !== "labels" || labelsRevealed : groupVisible[group];
      for (const id of ids) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  };

  const setState = (code: string | null, state: Record<string, boolean>) => {
    if (code) map.setFeatureState({ source: "municipalities", id: code }, state);
  };
  const setHoveredTown = (id: string | number | null) => {
    if (id === hoveredTown) return;
    if (hoveredTown !== null) map.setFeatureState({ source: "towns", id: hoveredTown }, { hover: false });
    hoveredTown = id;
    if (id !== null) map.setFeatureState({ source: "towns", id }, { hover: true });
  };

  map.on("mousemove", "muni-fill", (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const code = String(f.properties.code);
    if (code !== hovered) {
      setState(hovered, { hover: false });
      hovered = code;
      setState(hovered, { hover: true });
    }
    map.getCanvas().style.cursor = "pointer";
    // クイズ中は名前が出ると答えが分かるので、区域の強調だけにする
    if (quiz && !labelsRevealed) {
      popup.remove();
      return;
    }
    // 選択中の市区町村では町・大字名も表示する
    const town = map.getLayoutProperty("towns-fill", "visibility") === "none"
      ? undefined
      : map.queryRenderedFeatures(e.point, { layers: ["towns-fill"] })[0];
    setHoveredTown(town?.id ?? null);
    const label = [f.properties.prefName, f.properties.name, town?.properties.name].filter(Boolean).join(" ");
    popup.setLngLat(e.lngLat).setText(label).addTo(map);
  });
  const clearHover = () => {
    setState(hovered, { hover: false });
    setHoveredTown(null);
    hovered = null;
    map.getCanvas().style.cursor = "";
    popup.remove();
  };
  map.on("mouseleave", "muni-fill", clearHover);
  map.on("click", (e: MapMouseEvent) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    if (!quiz) {
      onSelect(f ? String(f.properties.code) : null);
      return;
    }
    if (f && onQuizAnswer) {
      onQuizAnswer({
        code: String(f.properties.code),
        name: String(f.properties.name),
        prefName: String(f.properties.prefName),
        lngLat: [e.lngLat.lng, e.lngLat.lat],
      });
    }
  });

  const fitBBox = (b: BBox) => map.fitBounds(b, { padding: 40, maxZoom: 14 });
  const source = (id: string) => map.getSource<GeoJSONSource>(id)!;

  const api: JapanMap = {
    map,
    fitBBox,
    select(m, opts = {}) {
      setState(selected, { selected: false });
      selected = m?.code ?? null;
      setState(selected, { selected: true });

      hoveredTown = null; // setData で地物 ID が振り直されるため
      source("selected").setData(m ? dataUrl(`${m.dir}/boundary.geojson`) : EMPTY);
      source("towns").setData(m?.hasTowns ? dataUrl(`${m.dir}/towns.geojson`) : EMPTY);
      if (m && opts.fit !== false) fitBBox(m.bbox);
    },
    setGroupVisible(group, visible) {
      groupVisible[group] = visible;
      applyVisibility();
    },
    setQuizMode(on, onAnswer) {
      quiz = on;
      onQuizAnswer = on ? onAnswer : undefined;
      labelsRevealed = false;
      clearHover();
      api.select(null);
      api.showQuizTarget(null);
      api.markAnswer(null);
      applyVisibility();
    },
    showQuizTarget(target) {
      hoveredTown = null;
      source("quiz-target").setData(target ? { type: "FeatureCollection", features: [target.feature] } : EMPTY);
      source("towns").setData(target?.towns ?? EMPTY);
      source("selected").setData(
        target?.municipality ? dataUrl(`${target.municipality.dir}/boundary.geojson`) : EMPTY,
      );
    },
    markAnswer(lngLat) {
      answerMarker?.remove();
      answerMarker = lngLat ? new maplibregl.Marker({ color: "#1f5f9e" }).setLngLat(lngLat).addTo(map) : null;
    },
    revealLabels(on) {
      labelsRevealed = on;
      applyVisibility();
    },
  };

  return new Promise((resolve) => map.once("load", () => resolve(api)));
}
