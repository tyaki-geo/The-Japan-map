import { describe, expect, it } from "vitest";
import { distanceKm } from "../src/lib/geo";
import {
  averageErrorPercent,
  boundsAround,
  clampRange,
  formatDistance,
  judgeDistance,
  measure,
  pickTargetKm,
  planDistanceQuestions,
} from "../src/lib/distance";
import { createRng } from "../src/lib/quiz";
import type { MunicipalityEntry } from "../src/types";

const muni = (code: string): MunicipalityEntry => ({
  code,
  name: `市${code}`,
  type: "郡市・東京都の区",
  areaKm2: 1,
  bbox: [0, 0, 1, 1],
  center: [139, 35],
  hasTowns: false,
  townCount: 0,
  dir: "",
});

describe("clampRange", () => {
  it("最小値は 1〜5km、最大値は 10〜50km に収める", () => {
    expect(clampRange({ minKm: 0, maxKm: 5 })).toEqual({ minKm: 1, maxKm: 10 });
    expect(clampRange({ minKm: 9, maxKm: 99 })).toEqual({ minKm: 5, maxKm: 50 });
    expect(clampRange({ minKm: 2.4, maxKm: 20.6 })).toEqual({ minKm: 2, maxKm: 21 });
  });
});

describe("pickTargetKm", () => {
  it("最小〜最大の整数で、両端も出る", () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(pickTargetKm({ minKm: 4, maxKm: 10 }, rng));
    expect([...seen].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("planDistanceQuestions", () => {
  const pool = ["a", "b", "c", "d"].map(muni);
  it("起点は重複せず、距離は範囲内", () => {
    const qs = planDistanceQuestions(pool, 3, { minKm: 2, maxKm: 12 }, createRng(7));
    expect(qs).toHaveLength(3);
    expect(new Set(qs.map((q) => q.origin.code)).size).toBe(3);
    for (const q of qs) {
      expect(Number.isInteger(q.targetKm)).toBe(true);
      expect(q.targetKm).toBeGreaterThanOrEqual(2);
      expect(q.targetKm).toBeLessThanOrEqual(12);
    }
  });

  it("起点が足りなければ出せる分だけ、0以下なら空", () => {
    expect(planDistanceQuestions(pool, 10, { minKm: 1, maxKm: 10 }, createRng(1))).toHaveLength(4);
    expect(planDistanceQuestions(pool, 0, { minKm: 1, maxKm: 10 }, createRng(1))).toEqual([]);
    expect(planDistanceQuestions([], 5, { minKm: 1, maxKm: 10 }, createRng(1))).toEqual([]);
  });
});

describe("judgeDistance", () => {
  it("誤差の割合でレベルが決まる", () => {
    expect(judgeDistance(10, 10.2).level).toBe("S");
    expect(judgeDistance(10, 11).level).toBe("A");
    expect(judgeDistance(10, 8.5).level).toBe("B");
    expect(judgeDistance(10, 13).level).toBe("C");
    expect(judgeDistance(10, 20).level).toBe("D");
  });

  it("誤差は 測った − 正解（遠すぎれば正）", () => {
    expect(judgeDistance(10, 12).errorKm).toBeCloseTo(2);
    expect(judgeDistance(10, 7).errorKm).toBeCloseTo(-3);
    expect(judgeDistance(10, 7).errorRatio).toBeCloseTo(0.3);
  });

  it("境界の割合は上のレベルに入る", () => {
    expect(judgeDistance(100, 110).level).toBe("A");
    expect(judgeDistance(100, 103).level).toBe("S");
  });
});

describe("measure", () => {
  const origin: [number, number] = [132.76, 33.84];

  it("届いていなければ線の延長上に正解がある", () => {
    const click: [number, number] = [132.9, 33.84];
    const m = measure(origin, click, 20);
    expect(m.short).toBe(true);
    expect(m.measuredKm).toBeCloseTo(distanceKm(origin, click), 9);
    expect(distanceKm(origin, m.correct)).toBeCloseTo(20, 6);
    // 正解の点はクリックした位置より先（原点からの距離が大きい）
    expect(distanceKm(origin, m.correct)).toBeGreaterThan(m.measuredKm);
  });

  it("行き過ぎていれば線の途中に正解がある", () => {
    const click: [number, number] = [133.2, 33.9];
    const m = measure(origin, click, 10);
    expect(m.short).toBe(false);
    expect(distanceKm(origin, m.correct)).toBeCloseTo(10, 6);
    // 原点〜クリック位置の線上にある（原点からの距離と、そこからクリック位置までの距離の和が全体）
    expect(distanceKm(origin, m.correct) + distanceKm(m.correct, click)).toBeCloseTo(m.measuredKm, 6);
  });
});

describe("averageErrorPercent", () => {
  it("誤差の割合の平均を % で返す", () => {
    expect(averageErrorPercent([{ errorRatio: 0.1 }, { errorRatio: 0.3 }])).toBeCloseTo(20);
    expect(averageErrorPercent([])).toBeNull();
  });
});

describe("formatDistance / boundsAround", () => {
  it("10km 未満は小数1桁", () => {
    expect(formatDistance(3.14159)).toBe("3.1 km");
    expect(formatDistance(12.6)).toBe("13 km");
  });

  it("起点を中心にした範囲の半径がおよそ指定どおり", () => {
    const c: [number, number] = [139, 35];
    const [w, s, e, n] = boundsAround(c, 20);
    expect(distanceKm(c, [c[0], n])).toBeCloseTo(20, 0);
    expect(distanceKm(c, [e, c[1]])).toBeCloseTo(20, 0);
    expect(w).toBeLessThan(c[0]);
    expect(s).toBeLessThan(c[1]);
  });
});
