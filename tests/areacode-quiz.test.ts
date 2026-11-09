import { describe, expect, it } from "vitest";
import { answersOf, areaCodePool, planAreaCodeQuestions } from "../src/lib/areacode";
import { createRng } from "../src/lib/quiz";
import type { DatasetIndex } from "../src/types";

const muni = (code: string) => ({
  code,
  name: code,
  type: "郡市・東京都の区",
  areaKm2: 1,
  bbox: [0, 0, 1, 1] as [number, number, number, number],
  center: [0, 0] as [number, number],
  hasTowns: false,
  townCount: 0,
  dir: "",
});
const index = {
  prefectures: [
    { code: "01", name: "北海道", bbox: [0, 0, 1, 1], municipalities: [muni("01203"), muni("01204")] },
    { code: "38", name: "愛媛県", bbox: [0, 0, 1, 1], municipalities: [muni("38201"), muni("38210")] },
  ],
} as unknown as DatasetIndex;
const areaCodes = { "011": ["01203", "01204"], "089": ["38201", "38210"], "0155": ["01204", "38210"] };

describe("areaCodePool", () => {
  it("出題範囲に1つでも入る市外局番", () => {
    expect(areaCodePool(areaCodes, index, ["38"])).toEqual(["0155", "089"]);
    expect(areaCodePool(areaCodes, index, ["01"])).toEqual(["011", "0155"]);
    expect(areaCodePool(areaCodes, index, [])).toEqual([]);
  });
});

describe("planAreaCodeQuestions", () => {
  const pool = ["011", "089", "0155"];
  it("重複せず、足りなければ出せる分だけ", () => {
    const qs = planAreaCodeQuestions(pool, 2, createRng(1));
    expect(qs).toHaveLength(2);
    expect(new Set(qs).size).toBe(2);
    expect(planAreaCodeQuestions(pool, 10, createRng(1)).sort()).toEqual([...pool].sort());
    expect(planAreaCodeQuestions(pool, 0, createRng(1))).toEqual([]);
  });
});

describe("answersOf", () => {
  it("index にある市区町村だけ", () => {
    expect(answersOf(areaCodes, "0155", new Set(["01204"]))).toEqual(["01204"]);
    expect(answersOf(areaCodes, "999", new Set(["01204"]))).toEqual([]);
  });
});
