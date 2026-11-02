// クイズモード: 看板風に出した地名を手がかりに、その場所を地図で答える。
// 当てはまる場所が複数あるときは、その数だけクリックしてすべて当てる（完全解答）のを目指す
import type { Feature, FeatureCollection } from "geojson";
import { loadDataset, municipalityFile } from "./lib/data";
import { h } from "./lib/dom";
import { distanceKm } from "./lib/geo";
import { drawSign } from "./lib/mosaic";
import {
  Attempt,
  MOSAIC_LEVEL_MAX,
  MOSAIC_LEVEL_MIN,
  QUESTION_COUNTS,
  answerCodes,
  clueMatches,
  makeClue,
  mosaicBlockRatio,
  municipalityPool,
  planQuestions,
  questionNames,
  type Clue,
  type Mark,
  type PlannedQuestion,
  type QuestionKind,
  type QuizConfig,
  type QuizKind,
  type QuizVariant,
  type Rng,
} from "./lib/quiz";
import { findMunicipality } from "./lib/search";
import { QUIZ_MARK_COLORS, type JapanMap, type QuizAnswer } from "./map";
import type { BBox, DatasetIndex, MunicipalityEntry, TownProps, TownsIndex } from "./types";

const KIND_INFO: Record<QuizKind, { title: string; description: string }> = {
  municipality: { title: "市区町村当て", description: "看板の市区町村名を見て、その場所を地図でクリックします。" },
  town: {
    title: "地名当て",
    description: "看板の町・大字名を見て、その地名がある市区町村を地図でクリックします。",
  },
  mixed: { title: "ミックス", description: "市区町村名と町・大字名の両方が出題されます。" },
};

const VARIANT_LABELS: Record<QuizVariant, string> = {
  normal: "通常",
  masked: "文字欠け（1文字を ○×△□ などに置き換え）",
  mosaic: "モザイク（文字が読みにくい）",
};

/** モザイクの濃さのプレビューに使う地名 */
const PREVIEW_CODE = "13104";
const PREVIEW_FALLBACK_NAME = "新宿区";
const SIGN_SIZE = { width: 288, height: 96 };
/** 答え合わせで町・大字の区域まで読み込んで示す市区町村の数の上限 */
const MAX_AREA_REVEAL = 20;

type TownCollection = FeatureCollection<Feature["geometry"], TownProps>;

interface Click {
  answer: QuizAnswer;
  mark: Mark;
  /** はずれのとき、最も近い正解までの距離 */
  nearestKm: number | null;
}

interface Question {
  kind: QuestionKind;
  clue: Clue;
  /** 看板の文字に当てはまる場所 */
  answers: MunicipalityEntry[];
  attempt: Attempt;
  clicks: Click[];
}

interface Session {
  plan: PlannedQuestion[];
  munis: MunicipalityEntry[];
  towns: TownsIndex | null;
  results: Question[];
}

export interface Game {
  show(kind: QuizKind): void;
  hide(): void;
}

export function createGame(root: HTMLElement, index: DatasetIndex, map: JapanMap): Game {
  const rng: Rng = Math.random;
  const config: QuizConfig = {
    kind: "municipality",
    variant: "normal",
    prefCodes: index.prefectures.map((p) => p.code),
    questionCount: 10,
    mosaicLevel: 4,
  };
  const prefName = new Map(index.prefectures.map((p) => [p.code, p.name]));
  const townAreasCache = new Map<string, Promise<TownCollection>>();
  const previewName = findMunicipality(index, PREVIEW_CODE)?.name ?? PREVIEW_FALLBACK_NAME;
  let townsIndex: Promise<TownsIndex> | null = null;

  let session: Session | null = null;
  let current: Question | null = null;
  let answering = false;
  /** 答え合わせで地図を動かす前の表示位置（次の問題で戻す） */
  let viewBeforeReveal: (() => void) | null = null;

  const loadTownsIndex = () => (townsIndex ??= loadDataset<TownsIndex>("towns-index.json"));
  const loadTownAreas = (m: MunicipalityEntry) => {
    let p = townAreasCache.get(m.code);
    if (!p) {
      p = loadDataset<TownCollection>(municipalityFile(m, "towns.geojson"));
      townAreasCache.set(m.code, p);
    }
    return p;
  };

  const placeName = (m: MunicipalityEntry) => `${prefName.get(m.code.slice(0, 2)) ?? ""} ${m.name}`;

  const scopeBBox = (): BBox | null => {
    const prefs = index.prefectures.filter((p) => config.prefCodes.includes(p.code));
    if (prefs.length === 0) return null;
    return [
      Math.min(...prefs.map((p) => p.bbox[0])),
      Math.min(...prefs.map((p) => p.bbox[1])),
      Math.max(...prefs.map((p) => p.bbox[2])),
      Math.max(...prefs.map((p) => p.bbox[3])),
    ];
  };
  const fitScope = () => {
    const b = scopeBBox();
    if (b) map.fitBBox(b);
  };

  const signCanvas = (text: string, mosaic: boolean) => {
    // 読み上げ用の説明。モザイクのときは文字を出すと答えが分かるので伏せる
    const label = mosaic ? "モザイクのかかった看板" : `看板: ${text}`;
    const canvas = h("canvas", { class: "sign", role: "img", "aria-label": label });
    drawSign(canvas, text, { ...SIGN_SIZE, mosaicRatio: mosaic ? mosaicBlockRatio(config.mosaicLevel) : undefined });
    return canvas;
  };

  /** 正解の数だけ並べる □（当たりは緑、はずれは赤、未回答は白抜き） */
  const answerBoxes = (q: Question) =>
    h(
      "div",
      { class: "boxes", "aria-label": `正解 ${q.attempt.total} か所のうち ${q.attempt.found.size} か所` },
      ...Array.from({ length: q.attempt.total }, (_, i) => h("span", { class: `box ${q.attempt.marks[i] ?? ""}` })),
    );

  // ---- 設定 ----
  function renderSetup() {
    session = null;
    current = null;
    answering = false;
    viewBeforeReveal = null;
    map.setQuizMode(true, onAnswer);
    const info = KIND_INFO[config.kind];

    // 出題範囲（都道府県を複数選べる）
    const selected = new Set(config.prefCodes);
    const scopeSummary = h("span", { class: "hint" });
    const checkboxes = index.prefectures.map((p) => {
      const cb = h("input", { type: "checkbox", value: p.code });
      cb.checked = selected.has(p.code);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(p.code);
        else selected.delete(p.code);
        applyScope();
      });
      return { cb, label: h("label", {}, cb, p.name) };
    });
    const setAll = (on: boolean) => {
      for (const { cb } of checkboxes) cb.checked = on;
      if (on) index.prefectures.forEach((p) => selected.add(p.code));
      else selected.clear();
      applyScope();
    };
    const allBtn = h("button", { type: "button", class: "small" }, "全国");
    allBtn.addEventListener("click", () => setAll(true));
    const noneBtn = h("button", { type: "button", class: "small" }, "すべて解除");
    noneBtn.addEventListener("click", () => setAll(false));
    const scope = h(
      "fieldset",
      { class: "options scope" },
      h("legend", {}, "出題範囲"),
      h("div", { class: "scope-actions" }, allBtn, noneBtn, scopeSummary),
      h("div", { class: "pref-grid" }, ...checkboxes.map((c) => c.label)),
    );

    const count = h("select", { "aria-label": "問題数" });
    for (const n of QUESTION_COUNTS) {
      count.append(h("option", { value: String(n) }, n === "all" ? "すべて（出題範囲内の全地名）" : `${n} 問`));
    }
    count.value = String(config.questionCount);
    count.addEventListener("change", () => {
      config.questionCount = count.value === "all" ? "all" : Number(count.value);
    });

    const variants = h("fieldset", { class: "options" }, h("legend", {}, "文字の見え方"));
    for (const v of Object.keys(VARIANT_LABELS) as QuizVariant[]) {
      const radio = h("input", { type: "radio", name: "variant", value: v });
      radio.checked = config.variant === v;
      radio.addEventListener("change", () => {
        config.variant = v;
        renderSetup();
      });
      variants.append(h("label", {}, radio, VARIANT_LABELS[v]));
    }

    const mosaic = h("fieldset", { class: "options mosaic" }, h("legend", {}, "モザイクの濃さ"));
    if (config.variant === "mosaic") {
      const level = h("input", {
        type: "range",
        min: String(MOSAIC_LEVEL_MIN),
        max: String(MOSAIC_LEVEL_MAX),
        step: "1",
        "aria-label": "モザイクの濃さ",
      });
      level.value = String(config.mosaicLevel);
      const value = h("output", {}, String(config.mosaicLevel));
      const preview = h("div", { class: "sign-preview" }, signCanvas(previewName, true));
      level.addEventListener("input", () => {
        config.mosaicLevel = Number(level.value);
        value.textContent = level.value;
        preview.replaceChildren(signCanvas(previewName, true));
      });
      mosaic.append(
        h("div", { class: "range" }, h("span", {}, "薄い"), level, h("span", {}, "濃い"), value),
        preview,
        h("p", { class: "hint" }, `プレビュー: ${previewName}`),
      );
    }

    const message = h("p", { class: "hint" });
    const start = h("button", { type: "button", class: "primary" }, "スタート");
    start.addEventListener("click", () => void startSession());

    // 出題できる地名の数（町・大字は一覧を読み込んでから数える）
    let availabilityToken = 0;
    function applyScope() {
      config.prefCodes = index.prefectures.map((p) => p.code).filter((c) => selected.has(c));
      scopeSummary.textContent = `${config.prefCodes.length} / ${index.prefectures.length} 都道府県`;
      fitScope();
      void updateAvailability();
    }
    async function updateAvailability() {
      const token = ++availabilityToken;
      const munis = municipalityPool(index, config.prefCodes);
      const muniNames = questionNames("municipality", munis, null).length;
      start.disabled = munis.length === 0;
      if (munis.length === 0) {
        message.textContent = "出題範囲の都道府県を選んでください";
        return;
      }
      if (config.kind === "municipality") {
        message.textContent = `出題できる市区町村名: ${muniNames} 件`;
        return;
      }
      message.textContent = "町・大字の一覧を読み込んでいます…";
      const towns = await loadTownsIndex();
      if (token !== availabilityToken) return;
      const townNames = questionNames("town", munis, towns).length;
      if (config.kind === "town") {
        start.disabled = townNames === 0;
        message.textContent = townNames === 0 ? "この範囲には町・大字のデータがありません" : `出題できる町・大字名: ${townNames} 件`;
      } else {
        message.textContent = `出題できる地名: 市区町村名 ${muniNames} 件・町・大字名 ${townNames} 件`;
      }
    }

    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        h("h2", {}, info.title),
        h("p", { class: "hint" }, info.description),
        scope,
        h("label", { class: "field" }, h("span", {}, "問題数"), count),
        variants,
        config.variant === "mosaic" ? mosaic : null,
        message,
        start,
      ),
    );
    applyScope();
  }

  // ---- 出題 ----
  async function startSession() {
    const munis = municipalityPool(index, config.prefCodes);
    const towns = config.kind === "municipality" ? null : await loadTownsIndex();
    const plan = planQuestions(config, munis, towns, rng);
    if (plan.length === 0) return renderSetup();
    session = { plan, munis, towns, results: [] };
    fitScope();
    viewBeforeReveal = null;
    nextQuestion();
  }

  function nextQuestion() {
    if (!session) return;
    const planned = session.plan[session.results.length];
    if (!planned) return renderFinish();
    viewBeforeReveal?.();
    viewBeforeReveal = null;
    map.clearQuizMarks();
    map.revealLabels(false);

    const clue = makeClue(planned.name, config.variant, rng);
    const answers = answerCodes(planned.kind, clue, session.munis, session.towns)
      .map((code) => findMunicipality(index, code))
      .filter((m): m is MunicipalityEntry => m !== undefined);
    current = { kind: planned.kind, clue, answers, attempt: new Attempt(answers.map((m) => m.code)), clicks: [] };
    answering = true;
    renderQuestion();
  }

  function renderQuestion(notice?: string) {
    const q = current!;
    const giveUp = h("button", { type: "button" }, "答えを見る");
    giveUp.addEventListener("click", () => void reveal());
    const remaining = q.attempt.total - q.attempt.marks.length;
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        progress(),
        h("p", { class: "prompt" }, q.kind === "municipality" ? "この市区町村はどこ？" : "この町・大字がある市区町村はどこ？"),
        h("div", { class: "sign-box" }, signCanvas(q.clue.text, config.variant === "mosaic")),
        h("p", { class: "count" }, `当てはまる場所: ${q.attempt.total} か所`),
        answerBoxes(q),
        h("p", { class: "hint" }, `地図で市区町村をクリックして答えてください（残り ${remaining} 回）`),
        notice ? h("p", { class: "notice" }, notice) : null,
        clickLog(q),
        h("div", { class: "actions" }, giveUp, quitButton()),
      ),
    );
  }

  function clickLog(q: Question) {
    if (q.clicks.length === 0) return null;
    return h(
      "ol",
      { class: "clicks" },
      ...q.clicks.map((c) =>
        h(
          "li",
          { class: c.mark === "found" ? "ok" : "ng" },
          h("span", { class: "mark" }, c.mark === "found" ? "○" : "×"),
          `${c.answer.prefName} ${c.answer.name}`,
          c.nearestKm !== null ? h("small", {}, `最も近い正解まで ${formatKm(c.nearestKm)}`) : null,
        ),
      ),
    );
  }

  function onAnswer(answer: QuizAnswer) {
    const q = current;
    if (!answering || !q) return;
    const mark = q.attempt.click(answer.code);
    if (mark === "duplicate") {
      renderQuestion("その市区町村はもう選んでいます");
      return;
    }
    const nearestKm =
      mark === "wrong" ? Math.min(...q.answers.map((m) => distanceKm(answer.lngLat, m.center))) : null;
    q.clicks.push({ answer, mark, nearestKm });
    map.setQuizMark(answer.code, mark);
    map.addMarker(answer.lngLat, QUIZ_MARK_COLORS[mark]);
    if (q.attempt.done) void reveal();
    else renderQuestion();
  }

  async function reveal() {
    const q = current;
    if (!session || !q || !answering) return;
    answering = false;
    session.results.push(q);

    for (const m of q.answers) if (!q.attempt.found.has(m.code)) map.setQuizMark(m.code, "missed");
    map.revealLabels(true);

    // 正解の場所とクリックした位置がすべて入るように地図を動かす
    const center = map.map.getCenter();
    const zoom = map.map.getZoom();
    viewBeforeReveal = () => map.map.jumpTo({ center, zoom });
    const points = q.clicks.map((c) => c.answer.lngLat);
    const boxes = q.answers.map((m) => m.bbox);
    map.fitBBox([
      Math.min(...boxes.map((b) => b[0]), ...points.map((p) => p[0])),
      Math.min(...boxes.map((b) => b[1]), ...points.map((p) => p[1])),
      Math.max(...boxes.map((b) => b[2]), ...points.map((p) => p[0])),
      Math.max(...boxes.map((b) => b[3]), ...points.map((p) => p[1])),
    ]);

    // 町・大字の問題は、当てはまる町・大字の区域も示す
    const townNames = new Map<string, string[]>();
    if (q.kind === "town" && session.towns) {
      for (const m of q.answers) townNames.set(m.code, (session.towns[m.code] ?? []).filter((n) => clueMatches(q.clue, n)));
      const shown = q.answers.slice(0, MAX_AREA_REVEAL);
      const collections = await Promise.all(shown.map(loadTownAreas));
      if (current !== q) return;
      map.showQuizAreas(
        collections.flatMap((fc, i) =>
          fc.features.filter(
            (f) => f.properties.kind === "area" && townNames.get(shown[i]!.code)?.includes(f.properties.name),
          ),
        ),
      );
    }

    const perfect = q.attempt.perfect;
    const last = session.results.length >= session.plan.length;
    const next = h("button", { type: "button", class: "primary" }, last ? "結果を見る" : "次の問題");
    next.addEventListener("click", nextQuestion);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        progress(),
        h(
          "p",
          { class: `verdict ${perfect ? "ok" : q.attempt.found.size > 0 ? "partial" : "ng"}` },
          perfect ? "◎ 完全解答！" : `${q.attempt.found.size} / ${q.attempt.total} か所 正解`,
        ),
        h("div", { class: "sign-box" }, signCanvas(q.clue.name, false)),
        answerBoxes(q),
        h("p", { class: "count" }, "正解の場所"),
        h(
          "ol",
          { class: "answers" },
          ...q.answers.map((m) => {
            const found = q.attempt.found.has(m.code);
            const names = townNames.get(m.code);
            return h(
              "li",
              { class: found ? "ok" : "missed" },
              h("span", { class: "mark" }, found ? "○" : "－"),
              placeName(m),
              names && names.length > 0 ? h("small", {}, names.join("・")) : null,
            );
          }),
        ),
        q.clicks.length > 0 ? h("p", { class: "count" }, "あなたの回答") : null,
        clickLog(q),
        h("div", { class: "actions" }, next, quitButton()),
      ),
    );
    next.focus();
  }

  function renderFinish() {
    if (!session) return renderSetup();
    current = null;
    answering = false;
    viewBeforeReveal?.();
    viewBeforeReveal = null;
    map.clearQuizMarks();
    map.revealLabels(false);
    const results = session.results;
    const perfect = results.filter((q) => q.attempt.perfect).length;
    const found = results.reduce((n, q) => n + q.attempt.found.size, 0);
    const total = results.reduce((n, q) => n + q.attempt.total, 0);
    const again = h("button", { type: "button", class: "primary" }, "もう一度");
    again.addEventListener("click", () => void startSession());
    const back = h("button", { type: "button" }, "設定に戻る");
    back.addEventListener("click", renderSetup);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        h("h2", {}, "結果"),
        h("p", { class: "score" }, `完全解答 ${perfect} / ${results.length} 問`),
        h("p", { class: "hint" }, `当てた場所: ${found} / ${total} か所`),
        h(
          "ol",
          { class: "results" },
          ...results.map((q) =>
            h(
              "li",
              { class: q.attempt.perfect ? "ok" : "ng" },
              h("span", { class: "mark" }, q.attempt.perfect ? "◎" : "×"),
              q.clue.name,
              h("small", {}, `${q.attempt.found.size} / ${q.attempt.total}`),
            ),
          ),
        ),
        h("div", { class: "actions" }, again, back),
      ),
    );
  }

  function progress() {
    const s = session!;
    const perfect = s.results.filter((q) => q.attempt.perfect).length;
    const number = s.results.length + (answering ? 1 : 0);
    return h("p", { class: "progress" }, `第 ${number} 問 / ${s.plan.length}`, h("small", {}, `完全解答 ${perfect}`));
  }

  function quitButton() {
    const quit = h("button", { type: "button" }, "やめる");
    quit.addEventListener("click", renderSetup);
    return quit;
  }

  return {
    show(kind) {
      config.kind = kind;
      renderSetup();
    },
    hide() {
      session = null;
      current = null;
      answering = false;
      map.setQuizMode(false);
      root.replaceChildren();
    },
  };
}

function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("ja-JP")} km`;
}
