import { filterPrefectures } from "./lib/search";
import { dataUrl } from "./lib/data";
import type { LayerGroup } from "./map";
import type { BBox, DatasetIndex, MunicipalityEntry, PrefectureEntry } from "./types";

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

const LAYER_LABELS: Record<LayerGroup, string> = {
  basemap: "背景地図（地理院 白地図）",
  municipalities: "都道府県・市区町村界",
  towns: "町・大字の区域（選択時）",
  labels: "名称ラベル",
};

export interface SidebarHandlers {
  onSelect(code: string): void;
  onFitPrefecture(bbox: BBox): void;
  onToggleLayer(group: LayerGroup, visible: boolean): void;
}

export interface Sidebar {
  setSelected(m: MunicipalityEntry | null): void;
}

export function createSidebar(root: HTMLElement, index: DatasetIndex, handlers: SidebarHandlers): Sidebar {
  const muniCount = index.prefectures.reduce((n, p) => n + p.municipalities.length, 0);
  const prefByCode = new Map(index.prefectures.map((p) => [p.code, p]));
  let selectedCode: string | null = null;

  const search = h("input", { type: "search", placeholder: "市区町村名・コードで検索", "aria-label": "検索" });
  const list = h("nav", { class: "pref-list", "aria-label": "市区町村一覧" });
  const info = h("section", { class: "info", "aria-live": "polite" });

  const layers = h("fieldset", { class: "layers" }, h("legend", {}, "レイヤ"));
  for (const group of Object.keys(LAYER_LABELS) as LayerGroup[]) {
    const cb = h("input", { type: "checkbox" });
    cb.checked = true;
    cb.addEventListener("change", () => handlers.onToggleLayer(group, cb.checked));
    layers.append(h("label", {}, cb, LAYER_LABELS[group]));
  }

  root.append(
    h(
      "header",
      {},
      h("h1", {}, "The Japan Map"),
      h(
        "p",
        { class: "summary" },
        `${index.prefectures.length} 都道府県 / ${muniCount} 市区町村 / 2次メッシュ ${index.source.meshes.length} 区画`,
      ),
    ),
    search,
    info,
    list,
    layers,
  );

  function renderList() {
    const prefs = filterPrefectures(index, search.value);
    const searching = search.value.trim() !== "";
    list.replaceChildren(
      ...prefs.map((pref) => renderPrefecture(pref, searching)),
      ...(prefs.length === 0 ? [h("p", { class: "empty" }, "該当する市区町村はありません")] : []),
    );
  }

  function renderPrefecture(pref: PrefectureEntry, open: boolean) {
    const fit = h("button", { type: "button", class: "fit", title: `${pref.name}全体を表示` }, "全体");
    fit.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onFitPrefecture(pref.bbox);
    });
    const details = h(
      "details",
      {},
      h("summary", {}, h("span", {}, `${pref.name}`), h("small", {}, ` ${pref.municipalities.length}`), fit),
      h(
        "ul",
        {},
        ...pref.municipalities.map((m) => {
          const btn = h("button", { type: "button", "data-code": m.code }, m.name, h("small", {}, m.code));
          if (m.code === selectedCode) btn.classList.add("active");
          btn.addEventListener("click", () => handlers.onSelect(m.code));
          return h("li", {}, btn);
        }),
      ),
    );
    details.open = open || pref.municipalities.some((m) => m.code === selectedCode);
    return details;
  }

  function renderInfo(m: MunicipalityEntry | null) {
    if (!m) {
      info.replaceChildren(h("p", { class: "hint" }, "地図または一覧から市区町村を選択してください"));
      return;
    }
    const pref = prefByCode.get(m.code.slice(0, 2));
    const row = (label: string, value: Child) => [h("dt", {}, label), h("dd", {}, value)];
    const link = (file: string) =>
      h("a", { href: dataUrl(`${m.dir}/${file}`), target: "_blank", rel: "noopener" }, file);
    info.replaceChildren(
      h("h2", {}, h("small", {}, pref?.name ?? ""), m.name),
      h(
        "dl",
        {},
        ...row("団体コード", m.code),
        ...row("種別", m.type),
        ...row("面積", `${m.areaKm2.toLocaleString("ja-JP")} km²（収録範囲内）`),
        ...row("町・大字", m.hasTowns ? `${m.townCount} 件` : "データなし"),
        ...row("データ", h("span", {}, link("boundary.geojson"), m.hasTowns && " ", m.hasTowns && link("towns.geojson"))),
      ),
    );
  }

  search.addEventListener("input", renderList);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = filterPrefectures(index, search.value)[0]?.municipalities[0];
    if (first) handlers.onSelect(first.code);
  });

  renderList();
  renderInfo(null);

  return {
    setSelected(m) {
      selectedCode = m?.code ?? null;
      renderInfo(m);
      for (const btn of list.querySelectorAll<HTMLButtonElement>("button[data-code]")) {
        const active = btn.dataset.code === selectedCode;
        btn.classList.toggle("active", active);
        if (active) {
          btn.closest("details")!.open = true;
          btn.scrollIntoView({ block: "nearest" });
        }
      }
    },
  };
}
