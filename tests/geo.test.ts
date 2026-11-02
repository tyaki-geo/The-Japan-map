import { describe, expect, it } from "vitest";
import { distanceKm, geometryBBox } from "../src/lib/geo";

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
