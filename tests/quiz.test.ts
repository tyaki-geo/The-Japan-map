import { describe, expect, it } from "vitest";
import {
  Attempt,
  VIEW_ANGLE_MAX,
  signedViewAngle,
  usesViewAngle,
  REGIONS,
  clampQuestionCount,
  percentFromQuestionCount,
  questionCountFromPercent,
  toggleRegion,
  MASK_SYMBOLS,
  answerCodes,
  clueMatches,
  createRng,
  makeClue,
  maskName,
  mosaicBlockRatio,
  municipalityPool,
  planQuestions,
  questionNames,
  type Clue,
  type QuizConfig,
} from "../src/lib/quiz";
import type { DatasetIndex, MunicipalityEntry, TownsIndex } from "../src/types";

const muni = (code: string, name: string, extra: Partial<MunicipalityEntry> = {}): MunicipalityEntry => ({
  code,
  name,
  type: "郡市・東京都の区",
  areaKm2: 1,
  bbox: [0, 0, 1, 1],
  center: [0, 0],
  hasTowns: true,
  townCount: 1,
  dir: `prefectures/${code.slice(0, 2)}/${code}`,
  ...extra,
});

const index: DatasetIndex = {
  generatedAt: "",
  source: { name: "", url: "", meshes: [], items: {} },
  prefectures: [
    {
      code: "11",
      name: "埼玉県",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("11230", "新座市")],
    },
    {
      code: "13",
      name: "東京都",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("13104", "新宿区"), muni("13801", "鳥島", { type: "その他" }), muni("13206", "府中市")],
    },
    {
      code: "33",
      name: "岡山県",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("33210", "新見市")],
    },
    {
      code: "34",
      name: "広島県",
      bbox: [0, 0, 1, 1],
      municipalities: [muni("34208", "府中市"), muni("34000", "（名称なし）")],
    },
  ],
};
const ALL = ["11", "13", "33", "34"];

const towns: TownsIndex = {
  "13104": ["西新宿", "本町"],
  "13206": ["本町", "宮町"],
  "34208": ["本町"],
};

const config = (kind: QuizConfig["kind"], questionCount: QuizConfig["questionCount"]): QuizConfig => ({
  kind,
  variant: "normal",
  prefCodes: ALL,
  questionCount,
  mosaicLevel: 4,
  viewAngle: 0,
});

const exact = (name: string): Clue => ({ name, text: name, wildcard: null });

describe("出題範囲", () => {
  it("所属未定地と名前の無いものを除く", () => {
    expect(municipalityPool(index, ALL).map((m) => m.code)).toEqual(["11230", "13104", "13206", "33210", "34208"]);
  });

  it("複数の都道府県を選べる", () => {
    expect(municipalityPool(index, ["13", "34"]).map((m) => m.code)).toEqual(["13104", "13206", "34208"]);
    expect(municipalityPool(index, [])).toEqual([]);
  });
});

describe("手がかりの文字", () => {
  it("1文字だけを記号に置き換え、その位置を返す", () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const { text, index: pos } = maskName("霞が関", rng);
      const chars = Array.from(text);
      expect(MASK_SYMBOLS).toContain(chars[pos]);
      expect(chars.filter((c, j) => c !== Array.from("霞が関")[j])).toHaveLength(1);
    }
  });

  it("市区町村の末尾は伏せない", () => {
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) expect(maskName("新宿区", rng).text.endsWith("区")).toBe(true);
  });

  it("文字欠け以外は伏せない", () => {
    expect(makeClue("新宿区", "mosaic", createRng(1))).toEqual(exact("新宿区"));
  });

  it("伏せた1文字は何でも当てはまる", () => {
    const clue: Clue = { name: "新座市", text: "新○市", wildcard: 1 };
    expect(clueMatches(clue, "新見市")).toBe(true);
    expect(clueMatches(clue, "新座市")).toBe(true);
    expect(clueMatches(clue, "新宿区")).toBe(false);
    expect(clueMatches(clue, "新発田市")).toBe(false);
    expect(clueMatches(exact("新座市"), "新見市")).toBe(false);
  });
});

describe("正解", () => {
  const munis = municipalityPool(index, ALL);

  it("同じ名前の市区町村はすべて正解", () => {
    expect(answerCodes("municipality", exact("府中市"), munis, towns)).toEqual(["13206", "34208"]);
  });

  it("文字欠けは当てはまる名前すべてが正解", () => {
    const clue: Clue = { name: "新座市", text: "新○市", wildcard: 1 };
    expect(answerCodes("municipality", clue, munis, towns)).toEqual(["11230", "33210"]);
  });

  it("町・大字はその名前がある市区町村すべて", () => {
    expect(answerCodes("town", exact("本町"), munis, towns)).toEqual(["13104", "13206", "34208"]);
    expect(answerCodes("town", exact("本町"), municipalityPool(index, ["13"]), towns)).toEqual(["13104", "13206"]);
  });
});

describe("planQuestions", () => {
  const munis = municipalityPool(index, ALL);

  it("同じ名前は1問にまとめる", () => {
    expect(questionNames("municipality", munis, towns).sort()).toEqual(["府中市", "新宿区", "新座市", "新見市"].sort());
    expect(questionNames("town", munis, towns).sort()).toEqual(["宮町", "本町", "西新宿"].sort());
  });

  it("「すべて」は範囲内のすべての地名", () => {
    const qs = planQuestions(config("mixed", "all"), munis, towns, createRng(1));
    expect(qs).toHaveLength(4 + 3);
    expect(new Set(qs.map((q) => `${q.kind}:${q.name}`)).size).toBe(7);
  });

  it("問題数を指定すると、その数（足りなければあるだけ）", () => {
    expect(planQuestions(config("municipality", 2), munis, towns, createRng(2))).toHaveLength(2);
    expect(planQuestions(config("town", 20), munis, towns, createRng(3))).toHaveLength(3);
  });

  it("町・大字の一覧が無ければ町・大字は出ない", () => {
    expect(planQuestions(config("town", 5), munis, null, createRng(4))).toEqual([]);
  });
});

describe("Attempt", () => {
  it("正解の数だけクリックでき、当たり・はずれを記録する", () => {
    const a = new Attempt(["A", "B", "C"]);
    expect(a.total).toBe(3);
    expect(a.click("A")).toBe("found");
    expect(a.click("X")).toBe("wrong");
    expect(a.done).toBe(false);
    expect(a.click("B")).toBe("found");
    expect(a.done).toBe(true);
    expect(a.marks).toEqual(["found", "wrong", "found"]);
    expect(a.perfect).toBe(false);
    expect(a.click("C")).toBe("duplicate");
  });

  it("同じ場所をもう一度クリックしても回数は減らない", () => {
    const a = new Attempt(["A", "B"]);
    a.click("A");
    expect(a.click("A")).toBe("duplicate");
    a.click("X");
    expect(a.click("X")).toBe("duplicate");
    expect(a.marks).toHaveLength(2);
  });

  it("すべて当てれば完全解答", () => {
    const a = new Attempt(["A"]);
    a.click("A");
    expect(a.perfect).toBe(true);
  });
});

describe("mosaicBlockRatio", () => {
  it("濃いほどマスが大きく、1〜10に収める", () => {
    expect(mosaicBlockRatio(1)).toBeLessThan(mosaicBlockRatio(10));
    expect(mosaicBlockRatio(0)).toBe(mosaicBlockRatio(1));
    expect(mosaicBlockRatio(99)).toBe(mosaicBlockRatio(10));
  });
});

describe("地方", () => {
  it("47都道府県をちょうど1回ずつ含む", () => {
    const codes = REGIONS.flatMap((r) => r.prefCodes);
    expect(codes).toHaveLength(47);
    expect(new Set(codes).size).toBe(47);
    expect(codes.sort()).toEqual(Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0")));
  });

  it("一部だけ選ばれていればすべて選び、すべて選ばれていれば外す", () => {
    const shikoku = REGIONS.find((r) => r.name === "四国")!.prefCodes;
    const once = toggleRegion(new Set(["38", "13"]), shikoku);
    expect([...once].sort()).toEqual(["13", "36", "37", "38", "39"]);
    expect([...toggleRegion(once, shikoku)]).toEqual(["13"]);
  });
});

describe("問題数", () => {
  it("範囲外の数は 1〜最大 に丸める", () => {
    expect(clampQuestionCount(-3, 91)).toBe(1);
    expect(clampQuestionCount(0, 91)).toBe(1);
    expect(clampQuestionCount(50000000, 91)).toBe(91);
    expect(clampQuestionCount(12.6, 91)).toBe(13);
    expect(clampQuestionCount(Number.NaN, 91)).toBeNull();
    expect(clampQuestionCount(5, 0)).toBeNull();
  });

  it("割合から問題数（最低1問）", () => {
    expect(questionCountFromPercent(100, 91)).toBe(91);
    expect(questionCountFromPercent(50, 91)).toBe(46);
    expect(questionCountFromPercent(1, 20)).toBe(1);
    expect(questionCountFromPercent(100, 0)).toBe(0);
  });

  it("問題数から割合", () => {
    expect(percentFromQuestionCount(91, 91)).toBe(100);
    expect(percentFromQuestionCount(1, 1000)).toBe(1);
    expect(percentFromQuestionCount(46, 91)).toBe(51);
  });
});

describe("横から見る角度", () => {
  it("大きさは選んだ角度、向きは左右ほぼ半々", () => {
    const rng = createRng(11);
    const angles = Array.from({ length: 400 }, () => signedViewAngle(40, "normal", rng));
    expect(new Set(angles.map(Math.abs))).toEqual(new Set([40]));
    const right = angles.filter((a) => a > 0).length;
    expect(right).toBeGreaterThan(150);
    expect(right).toBeLessThan(250);
  });

  it("モザイクでも使い、文字欠けでは使わない", () => {
    expect(usesViewAngle("normal")).toBe(true);
    expect(usesViewAngle("mosaic")).toBe(true);
    expect(usesViewAngle("masked")).toBe(false);
    expect(Math.abs(signedViewAngle(30, "mosaic", createRng(1)))).toBe(30);
    expect(signedViewAngle(30, "masked", createRng(1))).toBe(0);
  });

  it("0° は正面、範囲外は上限に収める", () => {
    expect(signedViewAngle(0, "normal", createRng(1))).toBe(0);
    expect(Math.abs(signedViewAngle(999, "normal", createRng(1)))).toBe(VIEW_ANGLE_MAX);
  });
});
