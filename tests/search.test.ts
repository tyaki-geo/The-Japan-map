import { describe, expect, it } from "vitest";
import { filterPrefectures, findMunicipality, normalize } from "../src/lib/search";
import type { DatasetIndex, MunicipalityEntry } from "../src/types";

const muni = (code: string, name: string): MunicipalityEntry => ({
  code,
  name,
  type: "",
  areaKm2: 0,
  bbox: [0, 0, 0, 0],
  center: [0, 0],
  hasTowns: false,
  townCount: 0,
  dir: `prefectures/${code.slice(0, 2)}/${code}`,
});

const index: DatasetIndex = {
  generatedAt: "",
  source: { name: "", url: "", meshes: [], items: {} },
  prefectures: [
    { code: "38", name: "愛媛県", bbox: [0, 0, 0, 0], municipalities: [muni("38201", "松山市"), muni("38202", "今治市")] },
    { code: "39", name: "高知県", bbox: [0, 0, 0, 0], municipalities: [muni("39201", "高知市"), muni("39386", "いの町")] },
  ],
};

describe("normalize", () => {
  it("カタカナ・全角を寄せる", () => {
    expect(normalize("イノ町")).toBe("いの町");
    expect(normalize("３８２０１")).toBe("38201");
  });
});

describe("filterPrefectures", () => {
  it("空なら全件", () => {
    expect(filterPrefectures(index, " ")).toBe(index.prefectures);
  });

  it("市区町村名で絞り込む", () => {
    const result = filterPrefectures(index, "松山");
    expect(result.map((p) => p.code)).toEqual(["38"]);
    expect(result[0]!.municipalities.map((m) => m.code)).toEqual(["38201"]);
  });

  it("カタカナ入力でもひらがなの名称に一致する", () => {
    expect(filterPrefectures(index, "イノ")[0]!.municipalities.map((m) => m.name)).toEqual(["いの町"]);
  });

  it("都道府県名に一致したらその市区町村すべて", () => {
    expect(filterPrefectures(index, "高知県")[0]!.municipalities).toHaveLength(2);
  });

  it("コードの前方一致", () => {
    expect(filterPrefectures(index, "392").flatMap((p) => p.municipalities.map((m) => m.code))).toEqual(["39201"]);
  });
});

describe("findMunicipality", () => {
  it("コードから引ける", () => {
    expect(findMunicipality(index, "39386")?.name).toBe("いの町");
    expect(findMunicipality(index, "99999")).toBeUndefined();
  });
});
