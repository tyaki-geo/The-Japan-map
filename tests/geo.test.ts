import { describe, expect, it } from "vitest";
import { bearingDeg, destinationPoint, distanceKm, geometryBBox, greatCircleLine } from "../src/lib/geo";

describe("geometryBBox", () => {
  it("MultiPolygon の範囲", () => {
    expect(
      geometryBBox({
        type: "MultiPolygon",
        coordinates: [[[[1, 2], [3, 2], [3, 5], [1, 2]]], [[[-1, 0], [0, 0], [0, 1], [-1, 0]]]],
      }),
    ).toEqual([-1, 0, 3, 5]);
  });

  it("空なら null", () => {
    expect(geometryBBox({ type: "MultiPolygon", coordinates: [] })).toBeNull();
  });
});

describe("distanceKm", () => {
  it("東京駅〜新大阪駅はおよそ400km", () => {
    const d = distanceKm([139.7671, 35.6812], [135.5003, 34.7334]);
    expect(d).toBeGreaterThan(395);
    expect(d).toBeLessThan(405);
  });

  it("同じ点は0", () => {
    expect(distanceKm([139, 35], [139, 35])).toBe(0);
  });
});

describe("bearingDeg / destinationPoint", () => {
  it("真東・真北の方位", () => {
    expect(bearingDeg([139, 0], [140, 0])).toBeCloseTo(90, 6);
    expect(bearingDeg([139, 35], [139, 36])).toBeCloseTo(0, 6);
    expect(bearingDeg([139, 36], [139, 35])).toBeCloseTo(180, 6);
  });

  it("進んだ先までの距離と方位が合う", () => {
    const start: [number, number] = [132.76, 33.84];
    for (const [brg, km] of [[0, 5], [75, 20], [200, 50], [310, 1]] as const) {
      const end = destinationPoint(start, brg, km);
      expect(distanceKm(start, end)).toBeCloseTo(km, 6);
      expect(bearingDeg(start, end)).toBeCloseTo(brg, 4);
    }
  });

  it("0km 進めば同じ点", () => {
    const [lng, lat] = destinationPoint([139.5, 35.5], 123, 0);
    expect(lng).toBeCloseTo(139.5, 9);
    expect(lat).toBeCloseTo(35.5, 9);
  });

  it("日付変更線をまたぐときも経度は -180〜180", () => {
    const [lng] = destinationPoint([179.9, 0], 90, 50);
    expect(lng).toBeGreaterThanOrEqual(-180);
    expect(lng).toBeLessThan(-179);
  });
});

describe("greatCircleLine", () => {
  it("両端は元の点で、途中の点は2点を結ぶ距離を保つ", () => {
    const a: [number, number] = [139.7671, 35.6812];
    const b: [number, number] = [135.5003, 34.7334];
    const line = greatCircleLine(a, b, 16);
    expect(line).toHaveLength(17);
    expect(line[0]![0]).toBeCloseTo(a[0], 9);
    expect(line[0]![1]).toBeCloseTo(a[1], 9);
    expect(line[16]![0]).toBeCloseTo(b[0], 9);
    expect(line[16]![1]).toBeCloseTo(b[1], 9);
    const total = distanceKm(a, b);
    // 途中の点までの距離の和は全体に等しい（一直線上にある）
    const sum = line.slice(1).reduce((n, p, i) => n + distanceKm(line[i]!, p), 0);
    expect(sum).toBeCloseTo(total, 6);
  });

  it("同じ点なら2点だけ", () => {
    expect(greatCircleLine([139, 35], [139, 35])).toEqual([[139, 35], [139, 35]]);
  });
});
