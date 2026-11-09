// 距離感覚モード: 市区町村の代表点から直線で ○km の地点を地図でクリックして答える
import { h } from "./lib/dom";
import {
  DEFAULT_DISTANCE_QUESTIONS,
  DEFAULT_MAX_KM,
  DEFAULT_MIN_KM,
  ERROR_LEVELS,
  MAX_DISTANCE_QUESTIONS,
  MAX_KM_BOUNDS,
  MIN_KM_BOUNDS,
  averageErrorPercent,
  boundsAround,
  clampRange,
  formatDistance,
  measure,
  planDistanceQuestions,
  type DistanceQuestion,
  type Measurement,
} from "./lib/distance";
import { greatCircleLine } from "./lib/geo";
import { municipalityPool, type Rng } from "./lib/quiz";
import { createScopePicker } from "./scope";
import type { JapanMap } from "./map";
import type { DatasetIndex } from "./types";

/** 地図の印の色: 起点 / 選んだ位置 / 正解の距離の地点 */
const MARKER_COLORS = { origin: "#24292f", pick: "#1f6feb", correct: "#2da44e" } as const;

interface Result {
  question: DistanceQuestion;
  measurement: Measurement;
}

interface Session {
  questions: DistanceQuestion[];
  results: Result[];
  maxKm: number;
}

export interface DistanceGame {
  show(): void;
  hide(): void;
}

export function createDistanceGame(root: HTMLElement, index: DatasetIndex, map: JapanMap): DistanceGame {
  const rng: Rng = Math.random;
  const config = {
    prefCodes: index.prefectures.map((p) => p.code),
    questionCount: DEFAULT_DISTANCE_QUESTIONS,
    minKm: DEFAULT_MIN_KM,
    maxKm: DEFAULT_MAX_KM,
  };
  const prefName = new Map(index.prefectures.map((p) => [p.code, p.name]));
  const placeName = (code: string, name: string) => `${prefName.get(code.slice(0, 2)) ?? ""} ${name}`;

  let session: Session | null = null;
  let current: DistanceQuestion | null = null;
  let answering = false;
  /** 選んだ位置（測定前は何度でも選び直せる） */
  let pick: [number, number] | null = null;
  let removePickMarker: (() => void) | null = null;
  let onPick: (() => void) | null = null;

  const resetMap = () => {
    map.clearQuizMarks();
    removePickMarker = null;
    pick = null;
  };

  // ---- 設定 ----
  function renderSetup() {
    session = null;
    current = null;
    answering = false;
    resetMap();
    map.setQuizMode(true, undefined, onMapClick);

    const message = h("p", { class: "hint" });
    const start = h("button", { type: "button", class: "primary" }, "スタート");
    const scopePicker = createScopePicker(index, config.prefCodes, (codes) => {
      config.prefCodes = codes;
      const n = municipalityPool(index, codes).length;
      start.disabled = n === 0;
      message.textContent = n === 0 ? "出題範囲の都道府県を選んでください" : `起点にできる市区町村: ${n} 件`;
      const prefs = index.prefectures.filter((p) => codes.includes(p.code));
      if (prefs.length > 0) {
        map.fitBBox([
          Math.min(...prefs.map((p) => p.bbox[0])),
          Math.min(...prefs.map((p) => p.bbox[1])),
          Math.max(...prefs.map((p) => p.bbox[2])),
          Math.max(...prefs.map((p) => p.bbox[3])),
        ]);
      }
    });

    const slider = (
      label: string,
      min: number,
      max: number,
      value: number,
      unit: string,
      onInput: (v: number) => void,
      showLabel = true,
    ) => {
      const input = h("input", { type: "range", min: String(min), max: String(max), step: "1", "aria-label": label });
      input.value = String(value);
      const out = h("output", {}, `${value}${unit}`);
      input.addEventListener("input", () => {
        out.textContent = `${input.value}${unit}`;
        onInput(Number(input.value));
      });
      return h("label", { class: "slider" }, showLabel ? h("span", {}, label) : null, h("div", { class: "range" }, input, out));
    };

    const count = h(
      "fieldset",
      { class: "options" },
      h("legend", {}, "問題数"),
      slider("問題数", 1, MAX_DISTANCE_QUESTIONS, config.questionCount, " 問", (v) => (config.questionCount = v), false),
    );
    // 出題する距離の最小値・最大値（それぞれ選べる範囲が決まっている）
    const range = h(
      "fieldset",
      { class: "options" },
      h("legend", {}, "出題する距離"),
      slider("最小", MIN_KM_BOUNDS.min, MIN_KM_BOUNDS.max, config.minKm, " km", (v) => (config.minKm = v)),
      slider("最大", MAX_KM_BOUNDS.min, MAX_KM_BOUNDS.max, config.maxKm, " km", (v) => (config.maxKm = v)),
      h("p", { class: "hint" }, "最小は 1〜5 km、最大は 10〜50 km から選べます"),
    );

    start.addEventListener("click", startSession);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        h("h2", {}, "距離感覚"),
        h(
          "p",
          { class: "hint" },
          "市区町村の代表点から直線で ○km の地点を、地図をクリックして答えます。実際の道のりは直線より長くなるので、あくまで地図上の距離の感覚です。",
        ),
        scopePicker.element,
        count,
        range,
        message,
        start,
      ),
    );
    scopePicker.refresh();
  }

  // ---- 出題 ----
  function startSession() {
    const range = clampRange({ minKm: config.minKm, maxKm: config.maxKm });
    const questions = planDistanceQuestions(municipalityPool(index, config.prefCodes), config.questionCount, range, rng);
    if (questions.length === 0) return renderSetup();
    session = { questions, results: [], maxKm: range.maxKm };
    nextQuestion();
  }

  function nextQuestion() {
    if (!session) return;
    const question = session.questions[session.results.length];
    if (!question) return renderFinish();
    resetMap();
    current = question;
    answering = true;
    map.addMarker(question.origin.center, MARKER_COLORS.origin);
    // 画面の広さが答えのヒントにならないよう、距離にかかわらず最大値の円が入る範囲を映す
    map.fitBBox(boundsAround(question.origin.center, session.maxKm * 1.1));
    renderQuestion();
  }

  function onMapClick(lngLat: [number, number]) {
    if (!answering) return;
    removePickMarker?.();
    pick = lngLat;
    removePickMarker = map.addMarker(lngLat, MARKER_COLORS.pick);
    onPick?.();
  }

  function renderQuestion() {
    const q = current!;
    const measureBtn = h("button", { type: "button", class: "primary" }, "測定する");
    measureBtn.disabled = true;
    measureBtn.addEventListener("click", reveal);
    const status = h("p", { class: "hint" }, "地図をクリックして場所を選びます（測定前なら選び直せます）");
    onPick = () => {
      measureBtn.disabled = false;
      status.textContent = "測定すると、選んだ位置までの距離と誤差が分かります";
    };
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        progress(),
        h("p", { class: "prompt" }, `${placeName(q.origin.code, q.origin.name)} の代表点（黒い印）から`),
        h("p", { class: "distance-target" }, `直線で ${q.targetKm} km`),
        h("p", { class: "hint" }, "の地点はどこ？"),
        status,
        h("div", { class: "actions" }, measureBtn, quitButton()),
      ),
    );
  }

  function reveal() {
    const q = current;
    const s = session;
    if (!q || !s || !answering || !pick) return;
    answering = false;
    const m = measure(q.origin.center, pick, q.targetKm);
    s.results.push({ question: q, measurement: m });

    // 起点 → 選んだ位置（大円に沿う線）。届いていなければ、同じ向きに延ばした先が正解の距離の地点
    map.showDistanceLines({
      measured: greatCircleLine(m.from, m.to),
      extension: m.short ? greatCircleLine(m.to, m.correct) : null,
    });
    map.addMarker(m.correct, MARKER_COLORS.correct);
    // 起点・選んだ位置・正解の地点がすべて入る範囲へ
    const lngs = [m.from[0], m.to[0], m.correct[0]];
    const lats = [m.from[1], m.to[1], m.correct[1]];
    void map.flyToBBox([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], 13);

    const last = s.results.length >= s.questions.length;
    const next = h("button", { type: "button", class: "primary" }, last ? "結果を見る" : "次の問題");
    next.addEventListener("click", nextQuestion);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        progress(),
        h("p", { class: `verdict level-${m.level}` }, `${m.level}　${m.levelLabel}`),
        resultTable(m),
        h(
          "p",
          { class: "hint" },
          m.short
            ? "青い実線が選んだ位置までの線、点線がその先の延長です。緑の印が正解の距離の地点です。"
            : "青い線が選んだ位置までの線で、緑の印がその線上の正解の距離の地点です。",
        ),
        h("div", { class: "actions" }, next, quitButton()),
      ),
    );
    next.focus();
  }

  function resultTable(m: Measurement) {
    const sign = m.errorKm > 0 ? "+" : m.errorKm < 0 ? "−" : "±";
    return h(
      "dl",
      { class: "distance-result" },
      h("dt", {}, "正解の距離"),
      h("dd", {}, formatDistance(m.targetKm)),
      h("dt", {}, "あなたの答え"),
      h("dd", {}, formatDistance(m.measuredKm)),
      h("dt", {}, "誤差"),
      h(
        "dd",
        {},
        `${sign}${formatDistance(Math.abs(m.errorKm))}（${Math.round(m.errorRatio * 100)}%、${m.errorKm > 0 ? "遠すぎ" : m.errorKm < 0 ? "近すぎ" : "ぴったり"}）`,
      ),
    );
  }

  function renderFinish() {
    if (!session) return renderSetup();
    current = null;
    answering = false;
    resetMap();
    const results = session.results;
    const avg = averageErrorPercent(results.map((r) => r.measurement));
    const again = h("button", { type: "button", class: "primary" }, "もう一度");
    again.addEventListener("click", startSession);
    const back = h("button", { type: "button" }, "設定に戻る");
    back.addEventListener("click", renderSetup);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        h("h2", {}, "結果"),
        h("p", { class: "score" }, avg === null ? "" : `平均誤差 ${avg.toFixed(0)}%`),
        h(
          "p",
          { class: "hint" },
          `誤差のレベル: ${ERROR_LEVELS.map((l) => `${l.level}（${l.max === Infinity ? "40%超" : `${Math.round(l.max * 100)}%以内`}）`).join(" ")}`,
        ),
        h(
          "ol",
          { class: "results" },
          ...results.map(({ question: q, measurement: m }) =>
            h(
              "li",
              { class: m.level === "S" || m.level === "A" ? "ok" : "ng" },
              h("span", { class: "mark" }, m.level),
              `${q.origin.name} から ${q.targetKm} km`,
              h("small", {}, `${formatDistance(m.measuredKm)}（${m.errorKm >= 0 ? "+" : "−"}${Math.round(m.errorRatio * 100)}%）`),
            ),
          ),
        ),
        h("div", { class: "actions" }, again, back),
      ),
    );
  }

  function progress() {
    const s = session!;
    const number = s.results.length + (answering ? 1 : 0);
    return h("p", { class: "progress" }, `第 ${number} 問 / ${s.questions.length}`);
  }

  function quitButton() {
    const quit = h("button", { type: "button" }, "やめる");
    quit.addEventListener("click", renderSetup);
    return quit;
  }

  return {
    show: renderSetup,
    hide() {
      session = null;
      current = null;
      answering = false;
      onPick = null;
      map.setQuizMode(false);
      root.replaceChildren();
    },
  };
}
