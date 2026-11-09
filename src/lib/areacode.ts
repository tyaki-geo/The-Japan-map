// 市外局番クイズの出題ロジック（DOM・地図に依存しない部分）
//
// 看板に出した市外局番（例: 0155）の区域に入る市区町村を、地図でクリックして答える。
// 区域は data/edited/area-codes.json（市外局番 -> 市区町村コード。作り方は scripts/areacode.ts）。
// 区域に入る市区町村が複数なら、その数だけクリックして、すべて当てる（完全解答）のを目指す
import type { AreaCodesIndex, DatasetIndex } from "../types";
import { shuffle, type Rng } from "./quiz";

export const DEFAULT_AREA_CODE_QUESTIONS = 10;
export const MAX_AREA_CODE_QUESTIONS = 50;

/** 出題範囲（都道府県）に1つでも入る市外局番。一部だけが範囲内でも出題する */
export function areaCodePool(
  areaCodes: AreaCodesIndex,
  index: DatasetIndex,
  prefCodes: readonly string[],
): string[] {
  const inScope = new Set(
    index.prefectures.filter((p) => prefCodes.includes(p.code)).flatMap((p) => p.municipalities.map((m) => m.code)),
  );
  return Object.keys(areaCodes)
    .filter((code) => areaCodes[code]!.some((c) => inScope.has(c)))
    .sort();
}

/** 出題する市外局番を重複なく選ぶ。足りなければ出せる分だけ */
export function planAreaCodeQuestions(pool: readonly string[], count: number, rng: Rng): string[] {
  return shuffle(pool, rng).slice(0, Math.max(0, count));
}

/** 市外局番の区域に入る市区町村（index にあるものだけ） */
export function answersOf(areaCodes: AreaCodesIndex, areaCode: string, known: ReadonlySet<string>): string[] {
  return (areaCodes[areaCode] ?? []).filter((c) => known.has(c));
}
