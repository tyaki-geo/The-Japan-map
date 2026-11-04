// クイズの出題ロジック（DOM・地図に依存しない部分）
//
// GeoGuessr の練習用。看板などで見かける地名の文字を手がかりに、その場所を地図で答える。
// 画質や距離で看板が読みにくい状況を、文字の一部を伏せる・文字にモザイクをかけることで再現する。
//
// 1問は「1つの地名（看板の文字）」。その文字に当てはまる場所は、出題範囲内のすべてが正解になる
// （同じ名前の市区町村・町・大字や、文字欠けで伏せた1文字に何が入っても成り立つ名前）。
// 正解が N 個なら N 回クリックでき、すべて当てる（完全解答）のを目指す。
import type { DatasetIndex, MunicipalityEntry, TownsIndex } from "../types";

/** 何を当てるか: 市区町村 / 市区町村以下の地名（町・大字） / その両方 */
export type QuizKind = "municipality" | "town" | "mixed";
export type QuestionKind = "municipality" | "town";
/** 手がかりの文字の見え方: そのまま / 1文字を記号に置き換える / 文字にモザイクをかける */
export type QuizVariant = "normal" | "masked" | "mosaic";
/** 問題数。"all" は出題範囲内のすべての地名 */
export type QuestionCount = number | "all";

export interface QuizConfig {
  kind: QuizKind;
  variant: QuizVariant;
  /** 出題範囲の都道府県コード（複数） */
  prefCodes: string[];
  questionCount: QuestionCount;
  /** モザイクの濃さ（1〜10） */
  mosaicLevel: number;
  /** 看板を横から見る角度の大きさ [度]（0 は正面）。左右どちらからかは出題ごとにランダム */
  viewAngle: number;
}

/** 出題範囲をまとめて選ぶ地方（都道府県コード） */
export const REGIONS: readonly { name: string; prefCodes: readonly string[] }[] = [
  { name: "北海道", prefCodes: ["01"] },
  { name: "東北", prefCodes: ["02", "03", "04", "05", "06", "07"] },
  { name: "関東", prefCodes: ["08", "09", "10", "11", "12", "13", "14"] },
  { name: "中部", prefCodes: ["15", "16", "17", "18", "19", "20", "21", "22", "23"] },
  { name: "近畿", prefCodes: ["24", "25", "26", "27", "28", "29", "30"] },
  { name: "中国", prefCodes: ["31", "32", "33", "34", "35"] },
  { name: "四国", prefCodes: ["36", "37", "38", "39"] },
  { name: "九州・沖縄", prefCodes: ["40", "41", "42", "43", "44", "45", "46", "47"] },
];

/** 地方のボタンを押したときの選択: その地方がすべて選ばれていれば外し、そうでなければすべて選ぶ */
export function toggleRegion(selected: ReadonlySet<string>, region: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = region.every((c) => next.has(c));
  for (const c of region) {
    if (all) next.delete(c);
    else next.add(c);
  }
  return next;
}

// ---- 問題数（出題できる地名の数に対する割合で決める） ----

export const DEFAULT_QUESTION_PERCENT = 100;

/** 問題数を 1〜出題できる数 に丸める。数でない入力は null */
export function clampQuestionCount(n: number, total: number): number | null {
  if (!Number.isFinite(n) || total <= 0) return null;
  return Math.min(total, Math.max(1, Math.round(n)));
}

/** 割合 [%] から問題数（最低1問） */
export function questionCountFromPercent(percent: number, total: number): number {
  if (total <= 0) return 0;
  return clampQuestionCount((total * percent) / 100, total)!;
}

/** 問題数から割合 [%]（スライダーの位置） */
export function percentFromQuestionCount(count: number, total: number): number {
  if (total <= 0) return DEFAULT_QUESTION_PERCENT;
  return Math.min(100, Math.max(1, Math.round((count / total) * 100)));
}
export const MASK_SYMBOLS = ["○", "×", "△", "□", "◇", "☆"] as const;
export const MOSAIC_LEVEL_MIN = 1;
export const MOSAIC_LEVEL_MAX = 10;
export const VIEW_ANGLE_MAX = 80;
export const VIEW_ANGLE_STEP = 5;

/** 出題に使わない市区町村（所属未定地や名前の無いもの） */
const QUIZ_MUNI_TYPES = new Set(["郡市・東京都の区", "町村・指定都市の区"]);

export type Rng = () => number;

/** 再現できる乱数（テスト・デバッグ用に種を指定できる） */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 出題範囲の市区町村（クイズに向かないものを除く） */
export function municipalityPool(index: DatasetIndex, prefCodes: readonly string[]): MunicipalityEntry[] {
  const codes = new Set(prefCodes);
  return index.prefectures
    .filter((p) => codes.has(p.code))
    .flatMap((p) => p.municipalities)
    .filter((m) => QUIZ_MUNI_TYPES.has(m.type) && !m.name.startsWith("（"));
}

// ---- 手がかりの文字 ----

export interface Clue {
  /** 出題した地名 */
  name: string;
  /** 看板に出す文字（文字欠けでは1文字が記号になる） */
  text: string;
  /** 伏せた文字の位置（文字単位）。伏せていなければ null */
  wildcard: number | null;
}

const MUNI_SUFFIX = /[市区町村]$/;

/**
 * 名前の1文字を記号に置き換える。
 * 市区町村の末尾（市・区・町・村）は伏せても簡単すぎるので、2文字以上ならそれ以外から選ぶ
 */
export function maskName(name: string, rng: Rng): { text: string; index: number } {
  const chars = Array.from(name);
  if (chars.length === 0) return { text: name, index: -1 };
  let positions = chars.map((_, i) => i);
  if (chars.length > 1 && MUNI_SUFFIX.test(name)) positions = positions.slice(0, -1);
  const index = positions[randomInt(rng, positions.length)]!;
  chars[index] = MASK_SYMBOLS[randomInt(rng, MASK_SYMBOLS.length)]!;
  return { text: chars.join(""), index };
}

/** 看板に出す文字を作る（モザイクは描画側でかけるので、文字はそのまま） */
export function makeClue(name: string, variant: QuizVariant, rng: Rng): Clue {
  if (variant !== "masked") return { name, text: name, wildcard: null };
  const { text, index } = maskName(name, rng);
  return { name, text, wildcard: index };
}

/** その名前が看板の文字に当てはまるか（伏せた1文字は何でもよい） */
export function clueMatches(clue: Clue, candidate: string): boolean {
  if (clue.wildcard === null) return candidate === clue.name;
  const a = Array.from(clue.name);
  const b = Array.from(candidate);
  return a.length === b.length && a.every((c, i) => i === clue.wildcard || c === b[i]);
}

// ---- 出題 ----

export interface PlannedQuestion {
  kind: QuestionKind;
  name: string;
}

/** 出題できる地名（同じ名前は1つにまとめる） */
export function questionNames(kind: QuestionKind, munis: readonly MunicipalityEntry[], towns: TownsIndex | null): string[] {
  const names =
    kind === "municipality" ? munis.map((m) => m.name) : munis.flatMap((m) => towns?.[m.code] ?? []);
  return [...new Set(names)];
}

/**
 * 出題する地名の並び。ミックスで問題数を決めた場合は、市区町村と町・大字を半々に出す。
 * 「すべて」は出題範囲内のすべての地名を出す
 */
export function planQuestions(
  config: QuizConfig,
  munis: readonly MunicipalityEntry[],
  towns: TownsIndex | null,
  rng: Rng,
): PlannedQuestion[] {
  const tagged = (kind: QuestionKind) => shuffle(questionNames(kind, munis, towns), rng).map((name) => ({ kind, name }));
  const muniQs = config.kind === "town" ? [] : tagged("municipality");
  const townQs = config.kind === "municipality" ? [] : tagged("town");
  if (config.questionCount === "all") return shuffle([...muniQs, ...townQs], rng);

  const out: PlannedQuestion[] = [];
  while (out.length < config.questionCount && (muniQs.length > 0 || townQs.length > 0)) {
    const fromTown = townQs.length > 0 && (muniQs.length === 0 || rng() < 0.5);
    out.push((fromTown ? townQs : muniQs).shift()!);
  }
  return out;
}

/** 看板の文字に当てはまる場所（市区町村コード）。町・大字は、その名前がある市区町村 */
export function answerCodes(
  kind: QuestionKind,
  clue: Clue,
  munis: readonly MunicipalityEntry[],
  towns: TownsIndex | null,
): string[] {
  return munis
    .filter((m) =>
      kind === "municipality" ? clueMatches(clue, m.name) : (towns?.[m.code] ?? []).some((n) => clueMatches(clue, n)),
    )
    .map((m) => m.code);
}

// ---- 回答 ----

export type Mark = "found" | "wrong";

/** 1問の回答状況。正解の数だけクリックでき、同じ場所を2回クリックしても回数は減らない */
export class Attempt {
  readonly answers: ReadonlySet<string>;
  readonly found = new Set<string>();
  readonly wrong = new Set<string>();
  readonly marks: Mark[] = [];

  constructor(answers: readonly string[]) {
    this.answers = new Set(answers);
  }

  get total(): number {
    return this.answers.size;
  }

  get done(): boolean {
    return this.marks.length >= this.total;
  }

  get perfect(): boolean {
    return this.found.size === this.total;
  }

  /** クリックした市区町村を判定する。終わった後や、すでにクリックした場所は "duplicate" */
  click(code: string): Mark | "duplicate" {
    if (this.done || this.found.has(code) || this.wrong.has(code)) return "duplicate";
    const mark: Mark = this.answers.has(code) ? "found" : "wrong";
    (mark === "found" ? this.found : this.wrong).add(code);
    this.marks.push(mark);
    return mark;
  }
}

/** モザイクの濃さ（1〜10）から、文字の高さに対する1マスの大きさの割合 */
export function mosaicBlockRatio(level: number): number {
  const l = Math.min(MOSAIC_LEVEL_MAX, Math.max(MOSAIC_LEVEL_MIN, Math.round(level)));
  // 1: 文字の高さの 1/30（ほぼ読める）〜 10: 1/3（ほぼ読めない）
  return l / 30;
}

/** 横から見る角度を使える見え方（文字欠けでは使わない） */
export function usesViewAngle(variant: QuizVariant): boolean {
  return variant !== "masked";
}

/**
 * 1問ごとの看板の向き [度]。大きさはプレイヤーが選んだ角度、符号（右から / 左から）は半々のランダム。
 * 文字欠けや正面（0°）では 0
 */
export function signedViewAngle(angle: number, variant: QuizVariant, rng: Rng): number {
  const a = Math.min(VIEW_ANGLE_MAX, Math.max(0, angle));
  if (!usesViewAngle(variant) || a === 0) return 0;
  return rng() < 0.5 ? -a : a;
}
