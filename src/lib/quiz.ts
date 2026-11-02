// クイズの出題ロジック（DOM・地図に依存しない部分）
//
// GeoGuessr の練習用。看板などで見かける地名の文字を手がかりに、その場所を地図で答える。
// 画質や距離で看板が読みにくい状況を、文字の一部を伏せる・文字にモザイクをかけることで再現する。
import type { DatasetIndex, MunicipalityEntry } from "../types";

/** 何を当てるか: 市区町村 / 市区町村以下の地名（町・大字） / その両方 */
export type QuizKind = "municipality" | "town" | "mixed";
/** 手がかりの文字の見え方: そのまま / 1文字を記号に置き換える / 文字にモザイクをかける */
export type QuizVariant = "normal" | "masked" | "mosaic";

export interface QuizConfig {
  kind: QuizKind;
  variant: QuizVariant;
  /** 出題範囲の都道府県コード。null は全国 */
  prefCode: string | null;
  questionCount: number;
  /** モザイクの濃さ（1〜10） */
  mosaicLevel: number;
}

export const MASK_SYMBOLS = ["○", "×", "△", "□", "◇", "☆"] as const;
export const MOSAIC_LEVEL_MIN = 1;
export const MOSAIC_LEVEL_MAX = 10;

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

export function pickRandom<T>(items: readonly T[], rng: Rng): T | undefined {
  return items.length === 0 ? undefined : items[randomInt(rng, items.length)];
}

/** 出題範囲の市区町村（クイズに向かないものを除く） */
export function municipalityPool(index: DatasetIndex, prefCode: string | null): MunicipalityEntry[] {
  return index.prefectures
    .filter((p) => prefCode === null || p.code === prefCode)
    .flatMap((p) => p.municipalities)
    .filter((m) => QUIZ_MUNI_TYPES.has(m.type) && !m.name.startsWith("（"));
}

/** 町・大字の問題を出せる市区町村 */
export function townMunicipalityPool(index: DatasetIndex, prefCode: string | null): MunicipalityEntry[] {
  return municipalityPool(index, prefCode).filter((m) => m.hasTowns && m.townCount > 0);
}

const MUNI_SUFFIX = /[市区町村]$/;

/**
 * 名前の1文字を記号に置き換える。
 * 市区町村の末尾（市・区・町・村）は伏せても簡単すぎるので、2文字以上ならそれ以外から選ぶ
 */
export function maskName(name: string, rng: Rng): string {
  const chars = Array.from(name);
  if (chars.length === 0) return name;
  let positions = chars.map((_, i) => i);
  if (chars.length > 1 && MUNI_SUFFIX.test(name)) positions = positions.slice(0, -1);
  const pos = positions[randomInt(rng, positions.length)]!;
  chars[pos] = MASK_SYMBOLS[randomInt(rng, MASK_SYMBOLS.length)]!;
  return chars.join("");
}

/** 手がかりとして見せる文字（モザイクは描画側でかけるので、文字はそのまま） */
export function clueText(name: string, variant: QuizVariant, rng: Rng): string {
  return variant === "masked" ? maskName(name, rng) : name;
}

/** 各問題で何を出すか（ミックスは市区町村と町・大字を半々）。町・大字を出せない範囲なら市区町村にする */
export function planKinds(config: QuizConfig, canAskTown: boolean, rng: Rng): ("municipality" | "town")[] {
  return Array.from({ length: config.questionCount }, () => {
    if (!canAskTown || config.kind === "municipality") return "municipality";
    if (config.kind === "town") return "town";
    return rng() < 0.5 ? "municipality" : "town";
  });
}

/**
 * 市区町村の問題の正誤。看板の文字だけでは同名の市区町村を区別できないので、名前が同じなら正解にする
 */
export function isCorrectMunicipality(target: MunicipalityEntry, clicked: Pick<MunicipalityEntry, "code" | "name">) {
  return clicked.code === target.code || clicked.name === target.name;
}

/** モザイクの濃さ（1〜10）から、文字の高さに対する1マスの大きさの割合 */
export function mosaicBlockRatio(level: number): number {
  const l = Math.min(MOSAIC_LEVEL_MAX, Math.max(MOSAIC_LEVEL_MIN, Math.round(level)));
  // 1: 文字の高さの 1/30（ほぼ読める）〜 10: 1/3（ほぼ読めない）
  return l / 30;
}

export interface Score {
  correct: number;
  answered: number;
}

export function scoreLabel(s: Score): string {
  return `${s.correct} / ${s.answered} 問正解`;
}
