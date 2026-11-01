import { describe, expect, it } from "vitest";
import { pickGroupName, townGroupName } from "../scripts/lib/towns";

describe("townGroupName", () => {
  it("漢数字・全角/半角数字の丁目を除く", () => {
    expect(townGroupName("枝松三丁目")).toBe("枝松");
    expect(townGroupName("平和通十丁目")).toBe("平和通");
    expect(townGroupName("別当５丁目")).toBe("別当");
    expect(townGroupName("栄町港3丁目")).toBe("栄町港");
  });

  it("丁目でない名称はそのまま", () => {
    expect(townGroupName("東川町")).toBe("東川町");
    expect(townGroupName("洲之内甲")).toBe("洲之内甲");
    expect(townGroupName("三津ふ頭")).toBe("三津ふ頭");
  });
});

describe("pickGroupName", () => {
  it("最も多いまとまり名を選ぶ", () => {
    expect(pickGroupName(["三津ふ頭", "三津一丁目", "三津二丁目"])).toBe("三津");
  });

  it("同数なら先に出たもの、空なら undefined", () => {
    expect(pickGroupName(["三津ふ頭", "三津三丁目"])).toBe("三津ふ頭");
    expect(pickGroupName([])).toBeUndefined();
  });
});
