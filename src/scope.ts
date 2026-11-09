// 出題範囲の選択（都道府県のチェックボックスと、地方ごとにまとめて選ぶボタン）。クイズの各モードで共通
import { h } from "./lib/dom";
import { REGIONS, toggleRegion } from "./lib/quiz";
import type { DatasetIndex } from "./types";

export interface ScopePicker {
  element: HTMLElement;
  /** 今の選択を onChange に渡して表示を整える（最初の表示時に呼ぶ） */
  refresh(): void;
}

/** onChange には選択中の都道府県コードを index.json の並びで渡す */
export function createScopePicker(
  index: DatasetIndex,
  initial: readonly string[],
  onChange: (prefCodes: string[]) => void,
): ScopePicker {
  const selected = new Set(initial);
  const scopeSummary = h("span", { class: "hint" });
  const checkboxes = index.prefectures.map((p) => {
    const cb = h("input", { type: "checkbox", value: p.code });
    cb.checked = selected.has(p.code);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(p.code);
      else selected.delete(p.code);
      apply();
    });
    return { cb, label: h("label", {}, cb, p.name) };
  });
  const syncCheckboxes = () => {
    for (const { cb } of checkboxes) cb.checked = selected.has(cb.value);
    apply();
  };
  const setAll = (on: boolean) => {
    selected.clear();
    if (on) index.prefectures.forEach((p) => selected.add(p.code));
    syncCheckboxes();
  };
  // 地方ごとにまとめて選ぶ（すべて選ばれていれば外す）
  const regionButtons = REGIONS.map((r) => {
    const btn = h("button", { type: "button", class: "small region", "aria-pressed": "false" }, r.name);
    btn.addEventListener("click", () => {
      const next = toggleRegion(selected, r.prefCodes);
      selected.clear();
      next.forEach((c) => selected.add(c));
      syncCheckboxes();
    });
    return { btn, region: r };
  });
  const updateRegionButtons = () => {
    for (const { btn, region } of regionButtons) {
      const all = region.prefCodes.every((c) => selected.has(c));
      btn.classList.toggle("active", all);
      btn.setAttribute("aria-pressed", String(all));
    }
  };
  const allBtn = h("button", { type: "button", class: "small" }, "全国");
  allBtn.addEventListener("click", () => setAll(true));
  const noneBtn = h("button", { type: "button", class: "small" }, "すべて解除");
  noneBtn.addEventListener("click", () => setAll(false));
  const element = h(
    "fieldset",
    { class: "options scope" },
    h("legend", {}, "出題範囲"),
    h("div", { class: "scope-actions" }, allBtn, noneBtn, scopeSummary),
    h("div", { class: "regions" }, ...regionButtons.map((r) => r.btn)),
    h("div", { class: "pref-grid" }, ...checkboxes.map((c) => c.label)),
  );

  function apply() {
    const codes = index.prefectures.map((p) => p.code).filter((c) => selected.has(c));
    scopeSummary.textContent = `${codes.length} / ${index.prefectures.length} 都道府県`;
    updateRegionButtons();
    onChange(codes);
  }

  return { element, refresh: apply };
}
