import { describe, expect, it } from "vitest";
import { columnSpan, projectYaw } from "../src/lib/perspective";

const W = 288;
const H = 96;

describe("projectYaw", () => {
  it("正面（0°）はそのまま映る", () => {
    const cols = projectYaw(W, H, 0);
    expect(cols).toHaveLength(W);
    cols.forEach((c, i) => {
      expect(c!.srcX).toBeCloseTo(i + 0.5, 6);
      expect(c!.scaleY).toBeCloseTo(1, 6);
    });
  });

  it("斜めから見ると横幅が縮み、近い側が大きく遠い側が小さく映る", () => {
    const cols = projectYaw(W, H, 50);
    const visible = cols.filter((c) => c !== null);
    expect(visible.length).toBeLessThan(W * 0.8);
    // +50° は看板の右側が奥へ下がる → 左（近い側）の縦の倍率が大きい
    expect(visible[0]!.scaleY).toBeGreaterThan(visible[visible.length - 1]!.scaleY);
    // 看板の左端から右端までが、順に映る
    expect(visible[0]!.srcX).toBeLessThan(2);
    expect(visible[visible.length - 1]!.srcX).toBeGreaterThan(W - 2);
    for (let i = 1; i < visible.length; i++) expect(visible[i]!.srcX).toBeGreaterThan(visible[i - 1]!.srcX);
  });

  it("画面からはみ出さない", () => {
    for (const yaw of [10, 30, 60, 80]) {
      for (const c of projectYaw(W, H, yaw)) {
        if (!c) continue;
        expect(c.scaleY).toBeLessThanOrEqual(1 + 1e-9);
        expect(c.srcX).toBeGreaterThanOrEqual(0);
        expect(c.srcX).toBeLessThanOrEqual(W);
      }
    }
  });

  it("左右逆から見ると鏡写しになる", () => {
    const right = projectYaw(W, H, 40);
    const left = projectYaw(W, H, -40);
    for (let i = 0; i < W; i++) {
      const a = right[i];
      const b = left[W - 1 - i];
      expect(a === null).toBe(b === null);
      if (a && b) {
        expect(a.srcX).toBeCloseTo(W - b.srcX, 6);
        expect(a.scaleY).toBeCloseTo(b.scaleY, 6);
      }
    }
  });

  it("角度が大きいほど細く映る", () => {
    const width = (yaw: number) => projectYaw(W, H, yaw).filter((c) => c !== null).length;
    expect(width(20)).toBeGreaterThan(width(45));
    expect(width(45)).toBeGreaterThan(width(75));
  });
});

describe("columnSpan", () => {
  it("中央そろえで縦に縮める", () => {
    expect(columnSpan(100, 1)).toEqual([0, 100]);
    expect(columnSpan(100, 0.5)).toEqual([25, 50]);
  });
});
