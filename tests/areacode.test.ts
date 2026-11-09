import { describe, expect, it } from "vitest";
import {
  buildAreaCodes,
  buildResolver,
  normalizeArea,
  parseAreaEntries,
  resolveArea,
  splitParen,
  splitTop,
  type District,
  type PrefRef,
} from "../scripts/areacode";

const m = (code: string, name: string) => ({ code, name });
const prefs: PrefRef[] = [
  {
    code: "01",
    name: "北海道",
    municipalities: [
      m("01101", "札幌市中央区"),
      m("01102", "札幌市北区"),
      m("01203", "小樽市"),
      m("01204", "江別市"),
      m("01303", "当別町"),
      m("01304", "新篠津村"),
      m("01633", "音更町"),
      m("01637", "幕別町"),
      m("01638", "池田町"),
      m("01639", "豊頃町"),
    ],
  },
  {
    code: "13",
    name: "東京都",
    municipalities: [m("13101", "千代田区"), m("13102", "中央区"), m("13205", "調布市"), m("13361", "大島町")],
  },
  {
    code: "12",
    name: "千葉県",
    municipalities: [m("12210", "鎌ケ谷市"), m("12211", "松戸市")],
  },
  {
    code: "28",
    name: "兵庫県",
    municipalities: [m("28224", "丹波篠山市"), m("28225", "養父市")],
  },
  {
    code: "20",
    name: "長野県",
    municipalities: [m("20481", "南木曽町"), m("20482", "木曽町"), m("20480", "上松町")],
  },
];
const districts: District[] = [
  { code: "01303", district: "石狩郡", name: "当別町" },
  { code: "01304", district: "石狩郡", name: "新篠津村" },
  { code: "01633", district: "河東郡", name: "音更町" },
  { code: "01637", district: "中川郡", name: "幕別町" },
  { code: "01638", district: "中川郡", name: "池田町" },
  { code: "01639", district: "中川郡", name: "豊頃町" },
  { code: "20481", district: "木曽郡", name: "南木曽町" },
  { code: "20482", district: "木曽郡", name: "木曽町" },
  { code: "20480", district: "木曽郡", name: "上松町" },
];
const resolver = buildResolver(prefs, districts);
const codes = (area: string) => resolveArea(area, resolver);

describe("splitTop / splitParen", () => {
  it("括弧の外だけで区切る", () => {
    expect(splitTop("A市（B、C）、D郡E町", ["、"])).toEqual(["A市（B、C）", "D郡E町"]);
  });

  it("括弧の中を限る・除くに分ける。町字の括弧がある項目は partial", () => {
    expect(splitParen("南巨摩郡（南部町及び身延町（相又、粟倉を除く。）に限る。）")).toEqual({
      main: "南巨摩郡",
      paren: {
        mode: "only",
        items: [
          { name: "南部町", partial: false },
          { name: "身延町", partial: true },
        ],
      },
    });
    expect(splitParen("A市").paren).toBeNull();
    expect(splitParen("A郡（B町を除く。）").paren?.mode).toBe("except");
  });
});

describe("normalizeArea", () => {
  it("ヶ→ケ、篠山市の改称、注記の除去", () => {
    expect(normalizeArea("鎌ヶ谷市、篠山市")).toBe("鎌ケ谷市、丹波篠山市");
    expect(normalizeArea("丹波篠山市")).toBe("丹波篠山市");
    expect(normalizeArea("糟屋郡（市外局番を除く電気通信番号による発信については、番号区画コード577の番号区画を含む。）")).toBe("糟屋郡");
  });
});

describe("resolveArea", () => {
  it("政令市は区をすべて、郡は町村をすべて", () => {
    expect(codes("北海道江別市、札幌市、空知郡南幌町").unresolved).toEqual(["北海道空知郡南幌町"]);
    expect(codes("北海道札幌市、石狩郡").codes).toEqual(["01101", "01102", "01303", "01304"]);
  });

  it("郡の括弧: 限る / 除く", () => {
    expect(codes("北海道中川郡（池田町及び豊頃町に限る。）").codes).toEqual(["01638", "01639"]);
    expect(codes("北海道中川郡（池田町及び豊頃町を除く。）").codes).toEqual(["01637"]);
  });

  it("郡＋町村。町字が続いたり括弧で町字を除いても、その町村は区域に入る", () => {
    expect(codes("北海道河東郡音更町、中川郡幕別町（忠類朝日、忠類共栄を除く。）").codes).toEqual(["01633", "01637"]);
    expect(codes("長野県木曽郡南木曽町田立").codes).toEqual(["20481"]);
  });

  it("郡の括弧で町字の一部だけを除くときは、その町村を残す", () => {
    expect(codes("長野県木曽郡（南木曽町田立を除く。）").codes).toEqual(["20480", "20481", "20482"]);
    expect(codes("長野県木曽郡（南木曽町を除く。）").codes).toEqual(["20480", "20482"]);
  });

  it("市の括弧（町字）は無視して市全体を入れる。区で限るときは区だけ", () => {
    expect(codes("北海道小樽市（銭函を除く。）").codes).toEqual(["01203"]);
    expect(codes("北海道札幌市（北区に限る。）").codes).toEqual(["01102"]);
    expect(codes("北海道札幌市（北区を除く。）").codes).toEqual(["01101"]);
    expect(codes("北海道札幌市（北区（東茨戸を除く。）を除く。）").codes).toEqual(["01101", "01102"]);
  });

  it("東京都23区、郡に属さない町村、市＋町字", () => {
    expect(codes("東京都23区、調布市（入間町に限る。）、大島町").codes).toEqual(["13101", "13102", "13205", "13361"]);
    expect(codes("北海道江別市宝水町").codes).toEqual(["01204"]);
  });

  it("県が途中で変わる区域。表記ゆれも当てはまる", () => {
    expect(codes("千葉県松戸市、鎌ヶ谷市、北海道小樽市").codes).toEqual(["01203", "12210", "12211"]);
    expect(codes("兵庫県篠山市").codes).toEqual(["28224"]);
  });

  it("当てはまらない項目は unresolved に出す", () => {
    expect(codes("北海道存在しない市、小樽市").unresolved).toEqual(["北海道存在しない市"]);
    expect(codes("北海道存在しない郡（A町に限る。）").unresolved).toHaveLength(1);
  });
});

describe("buildAreaCodes", () => {
  it("同じ市外局番の区画をまとめる。市区町村は複数の市外局番に入りうる", () => {
    const entries = parseAreaEntries(
      ["# 注釈", "1\t0155\tDE\t北海道河東郡音更町、中川郡幕別町（忠類朝日を除く。）", "2\t01558\tE\t北海道中川郡幕別町（忠類朝日に限る。）", "3\t0155\tDE\t北海道小樽市"].join("\n"),
    );
    const { areaCodes, unresolved } = buildAreaCodes(entries, resolver);
    expect(unresolved).toEqual([]);
    expect(areaCodes["0155"]).toEqual(["01203", "01633", "01637"]);
    expect(areaCodes["01558"]).toEqual(["01637"]);
  });

  it("壊れた行は読み込みで止める", () => {
    expect(() => parseAreaEntries("1\t0155")).toThrow();
  });
});
