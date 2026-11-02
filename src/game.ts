// クイズモード: 看板風に出した地名を手がかりに、その場所を地図で答える
import type { Feature, FeatureCollection } from "geojson";
import { loadDataset, municipalityFile } from "./lib/data";
import { h } from "./lib/dom";
import { distanceKm, geometryBBox } from "./lib/geo";
import { drawSign } from "./lib/mosaic";
import {
  MOSAIC_LEVEL_MAX,
  MOSAIC_LEVEL_MIN,
  clueText,
  isCorrectMunicipality,
  mosaicBlockRatio,
  municipalityPool,
  pickRandom,
  planKinds,
  scoreLabel,
  townMunicipalityPool,
  type QuizConfig,
  type QuizKind,
  type QuizVariant,
  type Rng,
} from "./lib/quiz";
import { findMunicipality } from "./lib/search";
import type { JapanMap, QuizAnswer, QuizTarget } from "./map";
import type { BBox, DatasetIndex, MunicipalityEntry, TownProps } from "./types";

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
const QUESTION_COUNTS = [5, 10, 20];

type TownCollection = FeatureCollection<Feature["geometry"], TownProps>;

interface Question {
  kind: "municipality" | "town";
  /** 市区町村の問題では答え、町・大字の問題ではその町・大字がある市区町村 */
  muni: MunicipalityEntry;
  /** 町・大字の問題の答え */
  townName?: string;
  /** 看板に出す文字 */
  clue: string;
  target: QuizTarget;
  /** 距離を測る正解の位置 */
  point: [number, number];
}

interface Result {
  question: Question;
  correct: boolean;
  answer: QuizAnswer | null;
  distanceKm: number | null;
}

export interface Game {
  show(kind: QuizKind): void;
  hide(): void;
}

export function createGame(root: HTMLElement, index: DatasetIndex, map: JapanMap): Game {
  const rng: Rng = Math.random;
  const config: QuizConfig = { kind: "municipality", variant: "normal", prefCode: null, questionCount: 10, mosaicLevel: 4 };
  const prefName = new Map(index.prefectures.map((p) => [p.code, p.name]));
  const townsCache = new Map<string, Promise<TownCollection>>();
  const previewName = findMunicipality(index, PREVIEW_CODE)?.name ?? PREVIEW_FALLBACK_NAME;

  let session: { questions: ("municipality" | "town")[]; results: Result[]; used: Set<string> } | null = null;
  let current: Question | null = null;
  let answering = false;
  /** 答え合わせで地図を動かす前の表示位置（次の問題で戻す） */
  let viewBeforeReveal: (() => void) | null = null;

  const loadTowns = (m: MunicipalityEntry) => {
    let p = townsCache.get(m.code);
    if (!p) {
      p = loadDataset<TownCollection>(municipalityFile(m, "towns.geojson"));
      townsCache.set(m.code, p);
    }
    return p;
  };

  const scopeBBox = (): BBox => {
    const prefs = index.prefectures.filter((p) => config.prefCode === null || p.code === config.prefCode);
    return [
      Math.min(...prefs.map((p) => p.bbox[0])),
      Math.min(...prefs.map((p) => p.bbox[1])),
      Math.max(...prefs.map((p) => p.bbox[2])),
      Math.max(...prefs.map((p) => p.bbox[3])),
    ];
  };

  const signCanvas = (text: string, mosaic: boolean) => {
    const canvas = h("canvas", { class: "sign", role: "img", "aria-label": "看板" });
    drawSign(canvas, text, { ...SIGN_SIZE, mosaicRatio: mosaic ? mosaicBlockRatio(config.mosaicLevel) : undefined });
    return canvas;
  };

  // ---- 設定 ----
  function renderSetup() {
    session = null;
    current = null;
    answering = false;
    map.setQuizMode(true, onAnswer);
    const info = KIND_INFO[config.kind];

    const scope = h("select", { "aria-label": "出題範囲" }, h("option", { value: "" }, "全国"));
    for (const p of index.prefectures) scope.append(h("option", { value: p.code }, p.name));
    scope.value = config.prefCode ?? "";

    const count = h("select", { "aria-label": "問題数" });
    for (const n of QUESTION_COUNTS) count.append(h("option", { value: String(n) }, `${n} 問`));
    count.value = String(config.questionCount);

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
      mosaic.append(h("div", { class: "range" }, h("span", {}, "薄い"), level, h("span", {}, "濃い"), value), preview, h("p", { class: "hint" }, `プレビュー: ${previewName}`));
    }

    const message = h("p", { class: "hint" });
    const start = h("button", { type: "button", class: "primary" }, "スタート");
    const updateAvailability = () => {
      const munis = municipalityPool(index, config.prefCode).length;
      const towns = townMunicipalityPool(index, config.prefCode).length;
      const canStart = config.kind === "town" ? towns > 0 : munis > 0;
      start.disabled = !canStart;
      message.textContent =
        config.kind === "town" && towns === 0
          ? "この範囲には町・大字のデータがありません"
          : config.kind === "mixed" && towns === 0
            ? "この範囲には町・大字のデータが無いため、市区町村だけが出題されます"
            : config.kind === "municipality"
              ? `出題対象: ${munis} 市区町村`
              : `出題対象: ${munis} 市区町村（町・大字データあり ${towns}）`;
    };
    scope.addEventListener("change", () => {
      config.prefCode = scope.value || null;
      updateAvailability();
      map.fitBBox(scopeBBox());
    });
    count.addEventListener("change", () => (config.questionCount = Number(count.value)));
    start.addEventListener("click", () => void startSession());
    updateAvailability();

    root.replaceChildren(
      h("section", { class: "quiz" },
        h("h2", {}, info.title),
        h("p", { class: "hint" }, info.description),
        h("label", { class: "field" }, h("span", {}, "出題範囲"), scope),
        h("label", { class: "field" }, h("span", {}, "問題数"), count),
        variants,
        config.variant === "mosaic" ? mosaic : null,
        message,
        start,
      ),
    );
  }

  // ---- 出題 ----
  async function startSession() {
    const canAskTown = townMunicipalityPool(index, config.prefCode).length > 0;
    session = { questions: planKinds(config, canAskTown, rng), results: [], used: new Set() };
    map.fitBBox(scopeBBox());
    viewBeforeReveal = null;
    await nextQuestion();
  }

  async function buildQuestion(kind: "municipality" | "town"): Promise<Question | null> {
    const used = session!.used;
    if (kind === "municipality") {
      const pool = municipalityPool(index, config.prefCode).filter((m) => !used.has(m.code));
      const m = pickRandom(pool, rng);
      if (!m) return null;
      used.add(m.code);
      const boundary = await loadDataset<FeatureCollection>(municipalityFile(m, "boundary.geojson"));
      return {
        kind,
        muni: m,
        clue: clueText(m.name, config.variant, rng),
        target: { feature: boundary.features[0]!, bbox: m.bbox },
        point: m.center,
      };
    }
    const pool = townMunicipalityPool(index, config.prefCode);
    // 同じ町・大字を出さないよう数回引き直す
    for (let attempt = 0; attempt < 8; attempt++) {
      const m = pickRandom(pool, rng);
      if (!m) return null;
      const towns = await loadTowns(m);
      const areas = towns.features.filter((f) => f.properties.kind === "area" && !used.has(`${m.code}:${f.properties.name}`));
      const area = pickRandom(areas, rng);
      if (!area) continue;
      const name = area.properties.name;
      used.add(`${m.code}:${name}`);
      const label = towns.features.find((f) => f.properties.kind === "label" && f.properties.name === name);
      const bbox = geometryBBox(area.geometry) ?? m.bbox;
      return {
        kind,
        muni: m,
        townName: name,
        clue: clueText(name, config.variant, rng),
        target: { feature: area, bbox, towns, municipality: m },
        point:
          label?.geometry.type === "Point"
            ? (label.geometry.coordinates as [number, number])
            : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      };
    }
    return null;
  }

  async function nextQuestion() {
    if (!session) return;
    const i = session.results.length;
    if (i >= session.questions.length) return renderFinish();
    viewBeforeReveal?.();
    viewBeforeReveal = null;
    map.revealLabels(false);
    map.showQuizTarget(null);
    map.markAnswer(null);
    root.replaceChildren(h("section", { class: "quiz" }, h("p", { class: "hint" }, "問題を準備しています…")));

    const q = (await buildQuestion(session.questions[i]!)) ?? (await buildQuestion("municipality"));
    if (!q) return renderFinish();
    current = q;
    answering = true;

    const skip = h("button", { type: "button" }, "わからない");
    skip.addEventListener("click", () => void reveal(null));
    root.replaceChildren(
      h("section", { class: "quiz" },
        progress(),
        h("p", { class: "prompt" }, q.kind === "municipality" ? "この市区町村はどこ？" : "この町・大字がある市区町村はどこ？"),
        h("div", { class: "sign-box" }, signCanvas(q.clue, config.variant === "mosaic")),
        h("p", { class: "hint" }, "地図で市区町村をクリックして答えてください"),
        h("div", { class: "actions" }, skip, quitButton()),
      ),
    );
  }

  function onAnswer(answer: QuizAnswer) {
    if (answering) void reveal(answer);
  }

  async function judge(q: Question, answer: QuizAnswer): Promise<{ correct: boolean; sameNameElsewhere: boolean }> {
    if (q.kind === "municipality") {
      const correct = isCorrectMunicipality(q.muni, answer);
      return { correct, sameNameElsewhere: correct && answer.code !== q.muni.code };
    }
    if (answer.code === q.muni.code) return { correct: true, sameNameElsewhere: false };
    // 同じ名前の町・大字が回答した市区町村にもあれば正解（看板の文字だけでは区別できない）
    const clicked = findMunicipality(index, answer.code);
    if (!clicked?.hasTowns) return { correct: false, sameNameElsewhere: false };
    const towns = await loadTowns(clicked);
    const found = towns.features.some((f) => f.properties.kind === "area" && f.properties.name === q.townName);
    return { correct: found, sameNameElsewhere: found };
  }

  async function reveal(answer: QuizAnswer | null) {
    const q = current;
    if (!session || !q || !answering) return;
    answering = false;
    const { correct, sameNameElsewhere } = answer ? await judge(q, answer) : { correct: false, sameNameElsewhere: false };
    const distance = answer && !correct ? distanceKm(answer.lngLat, q.point) : null;
    session.results.push({ question: q, correct, answer, distanceKm: distance });

    // 正解の場所（とクリックした位置）が入るように地図を動かす。
    // 町・大字は小さいので、どの市区町村にあるか分かるよう市区町村全体を映す
    const center = map.map.getCenter();
    const zoom = map.map.getZoom();
    viewBeforeReveal = () => map.map.jumpTo({ center, zoom });
    map.showQuizTarget(q.target);
    map.markAnswer(answer?.lngLat ?? null);
    map.revealLabels(true);
    const b = [...(q.kind === "town" ? q.muni.bbox : q.target.bbox)] as BBox;
    if (answer && !sameNameElsewhere) {
      b[0] = Math.min(b[0], answer.lngLat[0]);
      b[1] = Math.min(b[1], answer.lngLat[1]);
      b[2] = Math.max(b[2], answer.lngLat[0]);
      b[3] = Math.max(b[3], answer.lngLat[1]);
    }
    map.fitBBox(b);

    const place = [prefName.get(q.muni.code.slice(0, 2)), q.muni.name, q.townName].filter(Boolean).join(" ");
    const last = session.results.length >= session.questions.length;
    const next = h("button", { type: "button", class: "primary" }, last ? "結果を見る" : "次の問題");
    next.addEventListener("click", () => void nextQuestion());
    root.replaceChildren(
      h("section", { class: "quiz" },
        progress(),
        h("p", { class: `verdict ${correct ? "ok" : "ng"}` }, correct ? "○ 正解" : answer ? "× 不正解" : "– スキップ"),
        h("div", { class: "sign-box" }, signCanvas(q.townName ?? q.muni.name, false)),
        h("dl", {},
          h("dt", {}, "正解"), h("dd", {}, place),
          ...(answer ? [h("dt", {}, "あなたの回答"), h("dd", {}, `${answer.prefName} ${answer.name}`)] : []),
          ...(distance !== null ? [h("dt", {}, "距離"), h("dd", {}, `${formatKm(distance)} 離れています`)] : []),
        ),
        sameNameElsewhere ? h("p", { class: "hint" }, "回答した市区町村にも同じ名前の地名があるので正解です") : null,
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
    map.showQuizTarget(null);
    map.markAnswer(null);
    map.revealLabels(false);
    const results = session.results;
    const score = { correct: results.filter((r) => r.correct).length, answered: results.length };
    const again = h("button", { type: "button", class: "primary" }, "もう一度");
    again.addEventListener("click", () => void startSession());
    const back = h("button", { type: "button" }, "設定に戻る");
    back.addEventListener("click", renderSetup);
    root.replaceChildren(
      h("section", { class: "quiz" },
        h("h2", {}, "結果"),
        h("p", { class: "score" }, scoreLabel(score)),
        h("ol", { class: "results" },
          ...results.map((r) =>
            h("li", { class: r.correct ? "ok" : "ng" },
              h("span", { class: "mark" }, r.correct ? "○" : "×"),
              h("span", {}, [r.question.muni.name, r.question.townName].filter(Boolean).join(" ")),
              r.distanceKm !== null ? h("small", {}, formatKm(r.distanceKm)) : null,
            ),
          ),
        ),
        h("div", { class: "actions" }, again, back),
      ),
    );
  }

  function progress() {
    const s = session!;
    const correct = s.results.filter((r) => r.correct).length;
    return h("p", { class: "progress" },
      `第 ${Math.min(s.results.length + (answering ? 1 : 0), s.questions.length)} 問 / ${s.questions.length}`,
      h("small", {}, `正解 ${correct}`),
    );
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
