import "./style.css";
import { loadIndex } from "./lib/data";
import { findMunicipality } from "./lib/search";
import { createMap } from "./map";
import { createSidebar } from "./sidebar";

async function main(app: HTMLElement) {
  const sidebarEl = document.createElement("aside");
  sidebarEl.className = "sidebar";
  const mapEl = document.createElement("div");
  mapEl.className = "map";
  app.append(sidebarEl, mapEl);

  const index = await loadIndex();

  // 選択状態は URL ハッシュ（#38201 など）で保持し、applyHash を唯一の反映経路にする
  const selectCode = (code: string | null) => {
    const hash = code ? `#${code}` : "";
    if (window.location.hash !== hash) history.pushState(null, "", hash || window.location.pathname);
    applyHash();
  };

  const map = await createMap(mapEl, index, selectCode);
  const sidebar = createSidebar(sidebarEl, index, {
    onSelect: selectCode,
    onFitPrefecture: (bbox) => map.fitBBox(bbox),
    onToggleLayer: (group, visible) => map.setGroupVisible(group, visible),
  });

  let current: string | null = null;
  function applyHash() {
    const m = findMunicipality(index, window.location.hash.slice(1)) ?? null;
    if ((m?.code ?? null) === current) return;
    current = m?.code ?? null;
    map.select(m);
    sidebar.setSelected(m);
    document.title = m ? `${m.name} - The Japan Map` : "The Japan Map";
  }

  window.addEventListener("popstate", applyHash);
  applyHash();
}

const app = document.querySelector<HTMLDivElement>("#app")!;
main(app).catch((err: unknown) => {
  console.error(err);
  app.classList.add("error");
  app.textContent = `データの読み込みに失敗しました。npm run data:process を実行してください。（${String(err)}）`;
});
