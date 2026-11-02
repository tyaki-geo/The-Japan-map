import { describe, expect, it } from "vitest";
import {
  MASK_SYMBOLS,
  clueText,
  createRng,
  isCorrectMunicipality,
  maskName,
  mosaicBlockRatio,
  municipalityPool,
  planKinds,
  townMunicipalityPool,
  type QuizConfig,
} from "../src/lib/quiz";
import type { DatasetIndex, MunicipalityEntry } from "../src/types";

const muni = (code: string, name: string, extra: Partial<MunicipalityEntry> = {}): MunicipalityEntry => ({
  code,
  name,
  type: "郡市・東京都の区",
  areaKm2: 1,
  bbox: [0, 0, 1, 1],
  center: [0, 0],
  hasTowns: true,
  townCount: 10,
  dir: `prefectures/${code.slice(0, 2)}/${code}`,
  ...extra,
});

const index: DatasetIndex = {
  generatedAt: "",
  source: { name: "", url: "", meshes: [], items: {} },
  prefectures: [
    {
      code: "13",
      name: "東京都",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("13104", "新宿区"), muni("13801", "鳥島", { type: "その他" }), muni("13206", "府中市")],
    },
    {
      code: "34",
      name: "広島県",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("34208", "府中市", { hasTowns: false, townCount: 0 }), muni("34000", "（名称なし）")],
    },
  ],
};

const config = (kind: QuizConfig["kind"]): QuizConfig => ({
  kind,
  variant: "normal",
  prefCode: null,
  questionCount: 20,
  mosaicLevel: 5,
});

describe("出題範囲", () => {
  it("所属未定地と名前の無いものを除く", () => {
    expect(municipalityPool(index, null).map((m) => m.code)).toEqual(["13104", "13206", "34208"]);
  });

  it("都道府県で絞る", () => {
    expect(municipalityPool(index, "34").map((m) => m.code)).toEqual(["34208"]);
  });

  it("町・大字の問題は町・大字データのある市区町村だけ", () => {
    expect(townMunicipalityPool(index, null).map((m) => m.code)).toEqual(["13104", "13206"]);
  });
});

describe("maskName", () => {
  it("1文字だけを記号に置き換える", () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const masked = Array.from(maskName("霞が関", rng));
      const diff = masked.filter((c, j) => c !== Array.from("霞が関")[j]);
      expect(diff).toHaveLength(1);
      expect(MASK_SYMBOLS).toContain(diff[0]);
    }
  });

  it("市区町村の末尾は伏せない", () => {
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) expect(maskName("新宿区", rng).endsWith("区")).toBe(true);
  });

  it("1文字の名前でも伏せる", () => {
    expect(MASK_SYMBOLS).toContain(maskName("区", createRng(5)));
  });

  it("文字欠け以外は名前をそのまま出す", () => {
    expect(clueText("新宿区", "normal", createRng(1))).toBe("新宿区");
    expect(clueText("新宿区", "mosaic", createRng(1))).toBe("新宿区");
    expect(clueText("新宿区", "masked", createRng(1))).not.toBe("新宿区");
  });
});

describe("planKinds", () => {
  it("ミックスは両方出る", () => {
    const kinds = planKinds(config("mixed"), true, createRng(6));
    expect(kinds).toHaveLength(20);
    expect(kinds).toContain("municipality");
    expect(kinds).toContain("town");
  });

  it("町・大字を出せない範囲では市区町村だけ", () => {
    expect(new Set(planKinds(config("town"), false, createRng(7)))).toEqual(new Set(["municipality"]));
  });
});

describe("isCorrectMunicipality", () => {
  const target = muni("13206", "府中市");
  it("同じ市区町村なら正解", () => {
    expect(isCorrectMunicipality(target, { code: "13206", name: "府中市" })).toBe(true);
  });
  it("文字だけでは区別できない同名の市区町村も正解", () => {
    expect(isCorrectMunicipality(target, { code: "34208", name: "府中市" })).toBe(true);
  });
  it("違う市区町村は不正解", () => {
    expect(isCorrectMunicipality(target, { code: "13104", name: "新宿区" })).toBe(false);
  });
});

describe("mosaicBlockRatio", () => {
  it("濃いほどマスが大きく、1〜10に収める", () => {
    expect(mosaicBlockRatio(1)).toBeLessThan(mosaicBlockRatio(10));
    expect(mosaicBlockRatio(0)).toBe(mosaicBlockRatio(1));
    expect(mosaicBlockRatio(99)).toBe(mosaicBlockRatio(10));
  });
});
