// 距離感覚のクイズの出題ロジック（DOM・地図に依存しない部分）
//
// 市区町村の庁舎を起点に「ここから直線で ○km の地点」を地図でクリックして答える。
// 実際の道のりは直線より長いので、直線距離で鍛えるのは「どこどこまで ○km」の感覚のうち地図上の目安になる部分。
// 庁舎の位置は offices.json（data/edited、scripts/build-offices.ts で作る）。庁舎の無い市区町村は出題しない
import type { MunicipalityEntry, OfficesIndex } from "../types";
import { bearingDeg, destinationPoint, distanceKm, type LngLat } from "./geo";
import { randomInt, shuffle, type Rng } from "./quiz";

/** 出題する距離の最小値・最大値をそれぞれ選べる範囲 [km] */
export const MIN_KM_BOUNDS = { min: 1, max: 5 } as const;
export const MAX_KM_BOUNDS = { min: 10, max: 50 } as const;
export const DEFAULT_MIN_KM = 1;
export const DEFAULT_MAX_KM = 20;

export const DEFAULT_DISTANCE_QUESTIONS = 10;
export const MAX_DISTANCE_QUESTIONS = 30;

export interface DistanceRange {
  minKm: number;
  maxKm: number;
}

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** 最小値・最大値をそれぞれの選べる範囲に収める（最小値の範囲の最大 5 < 最大値の範囲の最小 10 なので逆転しない） */
export function clampRange(r: DistanceRange): DistanceRange {
  return {
    minKm: clampInt(r.minKm, MIN_KM_BOUNDS.min, MIN_KM_BOUNDS.max),
    maxKm: clampInt(r.maxKm, MAX_KM_BOUNDS.min, MAX_KM_BOUNDS.max),
  };
}

export interface DistanceQuestion {
  origin: MunicipalityEntry;
  /** 起点の位置 [経度, 緯度]（origin の庁舎） */
  point: [number, number];
  /** 起点からの直線距離 [km]（整数） */
  targetKm: number;
}

/** 出題する距離（最小〜最大 km の整数）を1つ選ぶ */
export function pickTargetKm(range: DistanceRange, rng: Rng): number {
  const { minKm, maxKm } = clampRange(range);
  return minKm + randomInt(rng, maxKm - minKm + 1);
}

/** 起点にできる市区町村（庁舎の位置がある） */
export function originPool(pool: readonly MunicipalityEntry[], offices: OfficesIndex): MunicipalityEntry[] {
  return pool.filter((m) => offices[m.code] !== undefined);
}

/** 起点の市区町村を重複なく選び、それぞれに距離を決める。起点の数が足りなければ出せる分だけ */
export function planDistanceQuestions(
  pool: readonly MunicipalityEntry[],
  offices: OfficesIndex,
  count: number,
  range: DistanceRange,
  rng: Rng,
): DistanceQuestion[] {
  return shuffle(originPool(pool, offices), rng)
    .slice(0, Math.max(0, count))
    .map((origin) => ({ origin, point: offices[origin.code]!, targetKm: pickTargetKm(range, rng) }));
}

// ---- 採点 ----

export type ErrorLevel = "S" | "A" | "B" | "C" | "D";

/** 誤差の割合（正解の距離に対する）の上限と、そのレベル */
export const ERROR_LEVELS: readonly { max: number; level: ErrorLevel; label: string }[] = [
  { max: 0.03, level: "S", label: "ほぼぴったり" },
  { max: 0.1, level: "A", label: "かなり正確" },
  { max: 0.2, level: "B", label: "おしい" },
  { max: 0.4, level: "C", label: "ずれている" },
  { max: Infinity, level: "D", label: "大きくずれている" },
];

export interface DistanceJudgement {
  targetKm: number;
  /** クリックした位置までの直線距離 */
  measuredKm: number;
  /** 測った距離 − 正解の距離（正なら遠すぎ、負なら近すぎ） */
  errorKm: number;
  /** 誤差の絶対値 ÷ 正解の距離 */
  errorRatio: number;
  level: ErrorLevel;
  levelLabel: string;
}

export function judgeDistance(targetKm: number, measuredKm: number): DistanceJudgement {
  const errorKm = measuredKm - targetKm;
  const errorRatio = targetKm > 0 ? Math.abs(errorKm) / targetKm : Infinity;
  const { level, label } = ERROR_LEVELS.find((l) => errorRatio <= l.max)!;
  return { targetKm, measuredKm, errorKm, errorRatio, level, levelLabel: label };
}

/** 起点とクリック位置から、答え合わせに出す測定結果 */
export interface Measurement extends DistanceJudgement {
  /** 起点 → クリック位置の線（大円に沿う）の端点 */
  from: LngLat;
  to: LngLat;
  /** 同じ向きに正解の距離だけ進んだ地点。線のどこが正しい距離かを示す */
  correct: [number, number];
  /** クリックした位置が正解の距離に届いていない（線を延ばした先が正解） */
  short: boolean;
}

export function measure(origin: LngLat, click: LngLat, targetKm: number): Measurement {
  const measuredKm = distanceKm(origin, click);
  return {
    ...judgeDistance(targetKm, measuredKm),
    from: origin,
    to: click,
    correct: destinationPoint(origin, bearingDeg(origin, click), targetKm),
    short: measuredKm < targetKm,
  };
}

/** 全問の平均誤差 [%]（問題ごとの誤差の割合の平均）。問題が無ければ null */
export function averageErrorPercent(results: readonly { errorRatio: number }[]): number | null {
  if (results.length === 0) return null;
  return (results.reduce((n, r) => n + r.errorRatio, 0) / results.length) * 100;
}

/** 距離の表示: 10km 未満は小数1桁、以上は整数 */
export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** 起点を中心に、半径 radiusKm の円が入る範囲 [west, south, east, north] */
export function boundsAround(center: LngLat, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.05, Math.cos((center[1] * Math.PI) / 180)));
  return [center[0] - dLng, center[1] - dLat, center[0] + dLng, center[1] + dLat];
}
