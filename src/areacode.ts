// 市外局番モード: 看板に出した市外局番の区域に入る市区町村を、地図でクリックして答える
import { loadDataset } from "./lib/data";
import { h } from "./lib/dom";
import { distanceKm } from "./lib/geo";
import {
  DEFAULT_AREA_CODE_QUESTIONS,
  MAX_AREA_CODE_QUESTIONS,
  answersOf,
  areaCodePool,
  planAreaCodeQuestions,
} from "./lib/areacode";
import { drawSign } from "./lib/mosaic";
import { Attempt, type Mark, type Rng } from "./lib/quiz";
import { QUIZ_MARK_COLORS, type JapanMap, type QuizAnswer } from "./map";
import { createScopePicker } from "./scope";
import type { AreaCodesIndex, BBox, DatasetIndex, MunicipalityEntry } from "./types";

const SIGN_SIZE = { width: 288, height: 96 };

interface Click {
  answer: QuizAnswer;
  mark: Mark;
  /** はずれのとき、最も近い正解までの距離 [km] */
  nearestKm: number | null;
}

interface Question {
  areaCode: string;
  answers: MunicipalityEntry[];
  attempt: Attempt;
  clicks: Click[];
}

interface Session {
  codes: string[];
  results: Question[];
}

export interface AreaCodeGame {
  show(): void;
  hide(): void;
}

export function createAreaCodeGame(root: HTMLElement, index: DatasetIndex, map: JapanMap): AreaCodeGame {
  const rng: Rng = Math.random;
  const config = {
    prefCodes: index.prefectures.map((p) => p.code),
    questionCount: DEFAULT_AREA_CODE_QUESTIONS,
  };
  const entries = new Map(index.prefectures.flatMap((p) => p.municipalities.map((m) => [m.code, m] as const)));
  const known = new Set(entries.keys());
  const prefName = new Map(index.prefectures.map((p) => [p.code, p.name]));
  const placeName = (m: MunicipalityEntry) => `${prefName.get(m.code.slice(0, 2)) ?? ""} ${m.name}`;

  let areaCodesPromise: Promise<AreaCodesIndex> | null = null;
  const loadAreaCodes = () => (areaCodesPromise ??= loadDataset<AreaCodesIndex>("area-codes.json"));
  let areaCodes: AreaCodesIndex | null = null;
  /** 設定画面を作り直したり閉じたりしたら進める（遅れて届いた読み込みの結果で画面を触らないため） */
  let setupToken = 0;

  let session: Session | null = null;
  let current: Question | null = null;
  let answering = false;

  const signCanvas = (text: string) => {
    const canvas = h("canvas", { class: "sign", role: "img", "aria-label": `看板: 市外局番 ${text}` });
    drawSign(canvas, text, SIGN_SIZE);
    return canvas;
  };

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
    map.setQuizMode(true, onAnswer);

    const message = h("p", { class: "hint" });
    const start = h("button", { type: "button", class: "primary" }, "スタート");
    const scopePicker = createScopePicker(index, config.prefCodes, (codes) => {
      config.prefCodes = codes;
      if (!areaCodes) {
        start.disabled = true;
        message.textContent = "市外局番のデータを読み込んでいます…";
      } else {
        const n = areaCodePool(areaCodes, index, codes).length;
        start.disabled = n === 0;
        message.textContent = n === 0 ? "出題範囲の都道府県を選んでください" : `出題できる市外局番: ${n} 種`;
      }
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

    const slider = h("input", {
      type: "range",
      min: "1",
      max: String(MAX_AREA_CODE_QUESTIONS),
      step: "1",
      "aria-label": "問題数",
    });
    slider.value = String(config.questionCount);
    const out = h("output", {}, `${config.questionCount} 問`);
    slider.addEventListener("input", () => {
      config.questionCount = Number(slider.value);
      out.textContent = `${slider.value} 問`;
    });
    const count = h("fieldset", { class: "options" }, h("legend", {}, "問題数"), h("div", { class: "range" }, slider, out));

    start.addEventListener("click", startSession);
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        h("h2", {}, "市外局番"),
        h(
          "p",
          { class: "hint" },
          "看板の市外局番の区域に入る市区町村を、地図でクリックして答えます。区域に入る市区町村の数だけクリックできます。区域の一部だけが入る市区町村も正解です。",
        ),
        scopePicker.element,
        count,
        message,
        start,
        h(
          "p",
          { class: "hint" },
          "市内局番（電話局の位置）は、位置を紐づけたデータが見つからないため出題しません。",
        ),
      ),
    );
    scopePicker.refresh();
    const token = ++setupToken;
    void loadAreaCodes().then((a) => {
      areaCodes = a;
      if (token === setupToken) scopePicker.refresh();
    });
  }

  // ---- 出題 ----
  function startSession() {
    if (!areaCodes) return;
    const codes = planAreaCodeQuestions(areaCodePool(areaCodes, index, config.prefCodes), config.questionCount, rng);
    if (codes.length === 0) return renderSetup();
    session = { codes, results: [] };
    nextQuestion();
  }

  function nextQuestion() {
    if (!session || !areaCodes) return;
    const areaCode = session.codes[session.results.length];
    if (!areaCode) return renderFinish();
    map.clearQuizMarks();
    map.revealLabels(false);
    const answers = answersOf(areaCodes, areaCode, known).map((c) => entries.get(c)!);
    current = { areaCode, answers, attempt: new Attempt(answers.map((m) => m.code)), clicks: [] };
    answering = true;
    renderQuestion();
  }

  function renderQuestion(notice?: string) {
    const q = current!;
    const giveUp = h("button", { type: "button" }, "答えを見る");
    giveUp.addEventListener("click", reveal);
    const remaining = q.attempt.total - q.attempt.marks.length;
    root.replaceChildren(
      h(
        "section",
        { class: "quiz" },
        progress(),
        h("p", { class: "prompt" }, "この市外局番の区域はどこ？"),
        h("div", { class: "sign-box" }, signCanvas(q.areaCode)),
        h("p", { class: "count" }, `区域に入る市区町村: ${q.attempt.total} か所`),
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
    if (q.attempt.done) reveal();
    else renderQuestion();
  }

  function reveal() {
    const q = current;
    if (!session || !q || !answering) return;
    answering = false;
    session.results.push(q);
    for (const m of q.answers) if (!q.attempt.found.has(m.code)) map.setQuizMark(m.code, "missed");
    map.revealLabels(true);

    // 区域と、クリックした位置がすべて入る範囲へ
    const points = q.clicks.map((c) => c.answer.lngLat);
    const boxes = q.answers.map((m) => m.bbox);
    const overall: BBox = [
      Math.min(...boxes.map((b) => b[0]), ...points.map((p) => p[0])),
      Math.min(...boxes.map((b) => b[1]), ...points.map((p) => p[1])),
      Math.max(...boxes.map((b) => b[2]), ...points.map((p) => p[0])),
      Math.max(...boxes.map((b) => b[3]), ...points.map((p) => p[1])),
    ];
    void map.flyToBBox(overall, 11);

    const perfect = q.attempt.perfect;
    const last = session.results.length >= session.codes.length;
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
        h("div", { class: "sign-box" }, signCanvas(q.areaCode)),
        answerBoxes(q),
        h("p", { class: "count" }, `区域に入る市区町村（${q.answers.length} か所）`),
        h(
          "ol",
          { class: "answers" },
          ...q.answers.map((m) => {
            const found = q.attempt.found.has(m.code);
            return h(
              "li",
              { class: found ? "ok" : "missed" },
              h("span", { class: "mark" }, found ? "○" : "－"),
              placeName(m),
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
    map.clearQuizMarks();
    map.revealLabels(false);
    const results = session.results;
    const perfect = results.filter((q) => q.attempt.perfect).length;
    const found = results.reduce((n, q) => n + q.attempt.found.size, 0);
    const total = results.reduce((n, q) => n + q.attempt.total, 0);
    const again = h("button", { type: "button", class: "primary" }, "もう一度");
    again.addEventListener("click", startSession);
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
              q.areaCode,
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
    return h("p", { class: "progress" }, `第 ${number} 問 / ${s.codes.length}`, h("small", {}, `完全解答 ${perfect}`));
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
      setupToken++;
      map.setQuizMode(false);
      root.replaceChildren();
    },
  };
}

function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("ja-JP")} km`;
}
