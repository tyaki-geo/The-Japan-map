import "./style.css";
import { loadIndex } from "./lib/data";
import { h } from "./lib/dom";
import type { QuizKind } from "./lib/quiz";
import { findMunicipality } from "./lib/search";
import { createGame } from "./game";
import { createMap } from "./map";
import { createSidebar } from "./sidebar";

type Mode = "study" | QuizKind;

const MODES: { mode: Mode; label: string }[] = [
  { mode: "study", label: "勉強モード" },
  { mode: "municipality", label: "市区町村当て" },
  { mode: "town", label: "地名当て" },
  { mode: "mixed", label: "ミックス" },
];

async function main(app: HTMLElement) {
  const sidebarEl = h("aside", { class: "sidebar" });
  const mapEl = h("div", { class: "map" });
  app.append(sidebarEl, mapEl);

  const index = await loadIndex();
  const muniCount = index.prefectures.reduce((n, p) => n + p.municipalities.length, 0);

  const tabs = h("nav", { class: "modes", "aria-label": "モード" });
  const studyEl = h("div", { class: "panel" });
  const quizEl = h("div", { class: "panel" });
  sidebarEl.append(
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
    tabs,
    studyEl,
    quizEl,
  );

  let mode: Mode = "study";

  // 勉強モードの選択状態は URL ハッシュ（#38201 など）で保持し、applyHash を唯一の反映経路にする
  const selectCode = (code: string | null) => {
    const hash = code ? `#${code}` : "";
    if (window.location.hash !== hash) history.pushState(null, "", hash || window.location.pathname);
    applyHash();
  };

  const map = await createMap(mapEl, index, selectCode);
  const sidebar = createSidebar(studyEl, index, {
    onSelect: selectCode,
    onFitPrefecture: (bbox) => map.fitBBox(bbox),
    onToggleLayer: (group, visible) => map.setGroupVisible(group, visible),
  });
  const game = createGame(quizEl, index, map);

  let current: string | null = null;
  function applyHash() {
    if (mode !== "study") return;
    const m = findMunicipality(index, window.location.hash.slice(1)) ?? null;
    if ((m?.code ?? null) === current) return;
    current = m?.code ?? null;
    map.select(m);
    sidebar.setSelected(m);
    document.title = m ? `${m.name} - The Japan Map` : "The Japan Map";
  }

  const tabButtons = MODES.map(({ mode: m, label }) => {
    const btn = h("button", { type: "button", "data-mode": m }, label);
    btn.addEventListener("click", () => setMode(m));
    return btn;
  });
  tabs.append(...tabButtons);

  function setMode(next: Mode) {
    mode = next;
    for (const btn of tabButtons) btn.classList.toggle("active", btn.dataset.mode === next);
    studyEl.hidden = next !== "study";
    quizEl.hidden = next === "study";
    if (next === "study") {
      game.hide();
      document.title = "The Japan Map";
      // 勉強モードに戻ったらハッシュの選択を復元する
      current = null;
      applyHash();
    } else {
      document.title = `${MODES.find((m) => m.mode === next)!.label} - The Japan Map`;
      game.show(next);
    }
  }

  window.addEventListener("popstate", applyHash);
  setMode("study");
}

const app = document.querySelector<HTMLDivElement>("#app")!;
main(app).catch((err: unknown) => {
  console.error(err);
  app.classList.add("error");
  app.textContent = `データの読み込みに失敗しました。npm run data:process を実行してください。（${String(err)}）`;
});
