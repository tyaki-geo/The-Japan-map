// 市外局番ごとの市区町村を決める（市外局番クイズの正解）
//
// 総務省の「市外局番の一覧」（data/sources/area-codes.tsv）は、市外局番ごとの区域を
// 「北海道帯広市、河西郡、河東郡音更町、中川郡幕別町（忠類朝日、…を除く。）」のように文章で書いている。
// これを、市（政令市は区をまとめて）・郡・郡の町村・町村に分けて、現在の市区町村コードに当てる。
//   - 郡と町村の対応は国土数値情報「行政区域」の郡名（data/sources/districts-n03.json）
//   - 市区町村の名前は data/edited/index.json
// 市区町村の一部だけが区域に入る場合（町字や政令市の区の一部で分かれる）も、その市区町村を正解に含める。
// 同じ市区町村が複数の市外局番に入ることがある（幕別町は 0155 と 01558 など）

export interface AreaEntry {
  /** 番号区画コード（例: 4-2） */
  block: string;
  /** 市外局番（先頭の 0 を含む。例: 0155） */
  areaCode: string;
  /** 市内局番の区分（DE など） */
  exchangeClass: string;
  /** 区域の文章 */
  area: string;
}

export interface District {
  code: string;
  district: string;
  name: string;
}

export interface MuniRef {
  code: string;
  name: string;
}

export interface PrefRef {
  code: string;
  name: string;
  municipalities: MuniRef[];
}

/** 区域の文章の表記を、現在の市区町村名に合わせる（ヶとケの違い、改称）。注記も除く */
export function normalizeArea(text: string): string {
  return text
    .replace(/（市外局番を除く電気通信番号による発信については、番号区画コード[0-9-]+の番号区画を含む。）/g, "")
    .replace(/(?<!丹波)篠山市/g, "丹波篠山市") // 2019年に篠山市から改称
    .replace(/[ヶヵ]/g, "ケ");
}

const normName = (s: string) => s.replace(/[ヶヵ]/g, "ケ");

/** TSV（# で始まる行は注釈）を読む。列: 番号区画コード / 市外局番 / 市内局番の区分 / 区域 */
export function parseAreaEntries(tsv: string): AreaEntry[] {
  return tsv
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => {
      const [block, areaCode, exchangeClass, area] = l.split("\t");
      if (!block || !areaCode || !exchangeClass || !area) throw new Error(`区画の行を読めません: ${l}`);
      return { block, areaCode, exchangeClass, area };
    });
}

// ---- 文章の分解 ----

/** 括弧（全角）の外にある separators で区切る */
export function splitTop(text: string, separators: readonly string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === "（") depth++;
    else if (c === "）") depth--;
    const sep = depth === 0 ? separators.find((s) => text.startsWith(s, i)) : undefined;
    if (sep) {
      parts.push(text.slice(start, i));
      i += sep.length;
      start = i;
    } else i++;
  }
  parts.push(text.slice(start));
  return parts.filter((p) => p !== "");
}

export interface Paren {
  mode: "only" | "except" | "unknown";
  /** 括弧の中の項目（それぞれ、名前と、その中の括弧の有無） */
  items: { name: string; partial: boolean }[];
}

/** "名前（括弧の中）" を、名前と括弧の中に分ける。括弧が無ければ paren は null */
export function splitParen(item: string): { main: string; paren: Paren | null } {
  const open = item.indexOf("（");
  if (open < 0) return { main: item, paren: null };
  let depth = 0;
  let close = -1;
  for (let i = open; i < item.length; i++) {
    if (item[i] === "（") depth++;
    else if (item[i] === "）" && --depth === 0) {
      close = i;
      break;
    }
  }
  let inner = item.slice(open + 1, close < 0 ? undefined : close);
  inner = inner.replace(/。$/, "");
  let mode: Paren["mode"] = "unknown";
  if (inner.endsWith("に限る")) mode = "only";
  else if (inner.endsWith("を除く")) mode = "except";
  inner = inner.replace(/(に限る|を除く)$/, "");
  const items = splitTop(inner, ["、", "及び", "並びに"]).map((x) => {
    const o = x.indexOf("（");
    return { name: o < 0 ? x : x.slice(0, o), partial: o >= 0 };
  });
  return { main: item.slice(0, open), paren: { mode, items } };
}

// ---- 市区町村への当てはめ ----

const SPECIAL_WARDS = "23区";

interface PrefTables {
  /** 名前（市区町村名そのまま）-> コード */
  byName: Map<string, string>;
  /** 市（政令市は区をまとめた名前、東京都は 23区）-> 区のコード（市は自分のコード1つ） */
  cities: Map<string, string[]>;
  /** 郡 -> 町村名 -> コード */
  districts: Map<string, Map<string, string>>;
  /** 郡に属さない町村名 -> コード（島しょの町村など） */
  towns: Map<string, string>;
  /** 政令市の区の名前（「札幌市中央区」の「中央区」）-> コード。市ごと */
  wards: Map<string, Map<string, string>>;
}

export interface Resolver {
  prefNames: string[];
  tables: Map<string, PrefTables>;
}

export function buildResolver(prefs: readonly PrefRef[], districts: readonly District[]): Resolver {
  const districtOf = new Map(districts.map((d) => [d.code, d]));
  const tables = new Map<string, PrefTables>();
  for (const pref of prefs) {
    const t: PrefTables = { byName: new Map(), cities: new Map(), districts: new Map(), towns: new Map(), wards: new Map() };
    for (const m of pref.municipalities) {
      if (m.name.startsWith("（") || m.code.slice(2).startsWith("8")) continue; // 名前の無いもの・所属未定地
      const n = Number(m.code.slice(2));
      const name = normName(m.name);
      t.byName.set(name, m.code);
      if (n >= 101 && n <= 199) {
        // 区（特別区・政令市の区）
        const city = pref.name === "東京都" ? SPECIAL_WARDS : name.slice(0, name.indexOf("市") + 1);
        t.cities.set(city, [...(t.cities.get(city) ?? []), m.code]);
        if (pref.name !== "東京都") {
          const w = t.wards.get(city) ?? new Map<string, string>();
          w.set(name.slice(city.length), m.code);
          t.wards.set(city, w);
        }
      } else if (n < 300) {
        t.cities.set(name, [m.code]);
      } else {
        const d = districtOf.get(m.code);
        if (d) {
          const g = t.districts.get(d.district) ?? new Map<string, string>();
          g.set(name, m.code);
          t.districts.set(d.district, g);
        } else t.towns.set(name, m.code);
      }
    }
    tables.set(pref.name, t);
  }
  return { prefNames: prefs.map((p) => p.name), tables };
}

export interface Resolved {
  codes: string[];
  /** 当てはまらなかった項目 */
  unresolved: string[];
}

const longestFirst = (names: Iterable<string>) => [...names].sort((a, b) => b.length - a.length);

/** 区域の文章1つ分（1つの番号区画）を市区町村コードにする */
export function resolveArea(area: string, resolver: Resolver): Resolved {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  let pref: string | null = null;
  for (let item of splitTop(normalizeArea(area), ["、"])) {
    const prefName = resolver.prefNames.find((p) => item.startsWith(p));
    if (prefName) {
      pref = prefName;
      item = item.slice(prefName.length);
    }
    const t = pref ? resolver.tables.get(pref) : undefined;
    if (!t) {
      unresolved.push(item);
      continue;
    }
    const found = resolveItem(item, t);
    if (found) found.forEach((c) => codes.add(c));
    else unresolved.push(`${pref}${item}`);
  }
  return { codes: [...codes].sort(), unresolved };
}

/** 町村名（あとに町字が続いてもよい）から町村を探す。町字が続くときは一部だけが対象 */
function findTown(towns: ReadonlyMap<string, string>, text: string): { code: string; partial: boolean } | null {
  const name = longestFirst(towns.keys()).find((n) => text.startsWith(n));
  return name ? { code: towns.get(name)!, partial: text.length > name.length } : null;
}

function resolveItem(item: string, t: PrefTables): string[] | null {
  const { main, paren } = splitParen(item);

  // 市区町村の名前そのまま（市、区、町村）
  const exact = t.byName.get(main);
  if (exact) return [exact];

  // 市（政令市・東京都の区は区のまとめ）。括弧は町字の限定なので無視するが、区で限定しているときは区だけにする
  const city = main === SPECIAL_WARDS ? SPECIAL_WARDS : longestFirst(t.cities.keys()).find((c) => main.startsWith(c));
  if (city) {
    const all = t.cities.get(city)!;
    const wards = t.wards.get(city);
    if (!paren || !wards || all.length === 1) return all;
    const wardOf = (name: string) => wards.get(name);
    if (paren.mode === "only") {
      const only = paren.items.map((i) => wardOf(i.name)).filter((c): c is string => c !== undefined);
      return only.length > 0 ? only : all;
    }
    if (paren.mode === "except") {
      // 区ごと除かれるもの（区の一部だけを除くものは、残りの部分が区域に入るので残す）
      const removed = new Set(paren.items.filter((i) => !i.partial).map((i) => wardOf(i.name)));
      return all.filter((c) => !removed.has(c));
    }
    return all;
  }

  // 郡（そのまま、または 郡＋町村）
  const gun = longestFirst(t.districts.keys()).find((g) => main.startsWith(g));
  if (gun) {
    const towns = t.districts.get(gun)!;
    const rest = main.slice(gun.length);
    if (rest !== "") {
      const town = findTown(towns, rest);
      return town ? [town.code] : null;
    }
    if (!paren) return [...towns.values()];
    const named = paren.items.map((i) => ({ ...findTown(towns, i.name), partialName: i.partial }));
    if (named.some((n) => n.code === undefined)) return null;
    if (paren.mode === "only") return named.map((n) => n.code!);
    if (paren.mode === "except") {
      // 町村ごと除かれるもの（町字の一部だけを除くものは、残りの部分が区域に入るので残す）
      const removed = new Set(named.filter((n) => !n.partial && !n.partialName).map((n) => n.code));
      return [...towns.values()].filter((c) => !removed.has(c));
    }
    return null;
  }

  // 郡に属さない町村
  const town = t.towns.get(main);
  return town ? [town] : null;
}

/** 市外局番 -> 市区町村コード（その市外局番の区域に入る市区町村。一部だけ入るものを含む） */
export function buildAreaCodes(
  entries: readonly AreaEntry[],
  resolver: Resolver,
): { areaCodes: Record<string, string[]>; unresolved: { block: string; areaCode: string; item: string }[] } {
  const map = new Map<string, Set<string>>();
  const unresolved: { block: string; areaCode: string; item: string }[] = [];
  for (const e of entries) {
    const r = resolveArea(e.area, resolver);
    const set = map.get(e.areaCode) ?? new Set<string>();
    r.codes.forEach((c) => set.add(c));
    map.set(e.areaCode, set);
    for (const item of r.unresolved) unresolved.push({ block: e.block, areaCode: e.areaCode, item });
  }
  const areaCodes = Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]),
  );
  return { areaCodes, unresolved };
}
