import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// バンドル後は maplibre-gl.mjs の隣に worker が置かれないため、Vite で配信した URL を明示する
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FeatureCollection } from "geojson";
import { dataUrl } from "./lib/data";
import type { BBox, DatasetIndex, MunicipalityEntry } from "./types";

maplibregl.setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// 都道府県ごとの塗り色（index.json の並び順に割り当て）
const PREF_COLORS = ["#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#e15759", "#76b7b2", "#edc948", "#9c755f"];

export const LAYER_GROUPS = {
  basemap: ["gsi-pale"],
  municipalities: ["muni-fill", "muni-line", "pref-line"],
  towns: ["towns-line", "towns-point"],
  labels: ["muni-label", "towns-label"],
} as const;
export type LayerGroup = keyof typeof LAYER_GROUPS;

export interface JapanMap {
  map: maplibregl.Map;
  select(m: MunicipalityEntry | null, opts?: { fit?: boolean }): void;
  setGroupVisible(group: LayerGroup, visible: boolean): void;
  fitBBox(bbox: BBox): void;
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
        "gsi-pale": {
          type: "raster",
          tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 18,
          attribution:
            '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a> / 基盤地図情報（国土地理院）を加工して作成',
        },
        prefectures: { type: "geojson", data: dataUrl("prefectures.geojson") },
        municipalities: { type: "geojson", data: dataUrl("municipalities.geojson"), promoteId: "code" },
        "muni-labels": { type: "geojson", data: labelPoints },
        selected: { type: "geojson", data: EMPTY },
        towns: { type: "geojson", data: EMPTY },
      },
      layers: [
        { id: "gsi-pale", type: "raster", source: "gsi-pale" },
        {
          id: "muni-fill",
          type: "fill",
          source: "municipalities",
          paint: {
            "fill-color": prefColor,
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.5,
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
          id: "towns-line",
          type: "line",
          source: "towns",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#c0392b", "line-width": 1, "line-dasharray": [3, 2] },
        },
        {
          id: "towns-point",
          type: "circle",
          source: "towns",
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-radius": 3, "circle-color": "#c0392b", "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
        },
        {
          id: "selected-line",
          type: "line",
          source: "selected",
          paint: { "line-color": "#d35400", "line-width": 3 },
        },
        {
          id: "towns-label",
          type: "symbol",
          source: "towns",
          minzoom: 12,
          filter: ["==", ["geometry-type"], "Point"],
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["sans-serif"],
            "text-size": 12,
            "text-offset": [0, 0.9],
            "text-anchor": "top",
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
  let selected: string | null = null;

  const setState = (code: string | null, state: Record<string, boolean>) => {
    if (code) map.setFeatureState({ source: "municipalities", id: code }, state);
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
    popup.setLngLat(e.lngLat).setText(`${f.properties.prefName} ${f.properties.name}`).addTo(map);
  });
  map.on("mouseleave", "muni-fill", () => {
    setState(hovered, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = "";
    popup.remove();
  });
  map.on("click", (e: MapMouseEvent) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ["muni-fill"] })[0];
    onSelect(f ? String(f.properties.code) : null);
  });

  const fitBBox = (b: BBox) => map.fitBounds(b, { padding: 40, maxZoom: 14 });

  const api: JapanMap = {
    map,
    fitBBox,
    select(m, opts = {}) {
      setState(selected, { selected: false });
      selected = m?.code ?? null;
      setState(selected, { selected: true });

      const selectedSrc = map.getSource<GeoJSONSource>("selected")!;
      const townsSrc = map.getSource<GeoJSONSource>("towns")!;
      selectedSrc.setData(m ? dataUrl(`${m.dir}/boundary.geojson`) : EMPTY);
      townsSrc.setData(m?.hasTowns ? dataUrl(`${m.dir}/towns.geojson`) : EMPTY);
      if (m && opts.fit !== false) fitBBox(m.bbox);
    },
    setGroupVisible(group, visible) {
      for (const id of LAYER_GROUPS[group]) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
      // 選択中の詳細境界は市区町村レイヤに連動させる
      if (group === "municipalities") {
        map.setLayoutProperty("selected-line", "visibility", visible ? "visible" : "none");
      }
    },
  };

  return new Promise((resolve) => map.once("load", () => resolve(api)));
}
