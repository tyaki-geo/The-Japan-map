// 市区町村の庁舎の位置を決める（距離感覚モードの起点）
//
// 出どころ（data/sources/）
//   offices-p05.json   国土数値情報「市町村役場等及び公的集会施設」(P05-10) のうち施設分類が「本庁」のもの
//   offices-extra.json P05 に無い市区町村（P05 のあと、2012年の熊本市の政令市移行で増えた区）。OpenStreetMap の区役所の位置
// P05 は2010年のデータなので、その後に市制施行・区の再編があった市区町村は旧コードの庁舎から引き継ぐ（SUCCESSORS）。
// どれにも当てはまらない市区町村（北方領土の村や無人島）は庁舎が無いので出力しない。

export interface OfficeSource {
  code: string;
  name: string;
  lon: number;
  lat: number;
}

export interface ExtraOffice {
  name: string;
  lon: number;
  lat: number;
  source: string;
}

/** 旧コード（P05 にある） -> 新コード（現在の市区町村）。庁舎は同じ場所のまま引き継ぐ */
export const SUCCESSORS: Readonly<Record<string, string>> = {
  // 町村から市になった（2010年以降）
  "03305": "03216", // 滝沢村 -> 滝沢市
  "04423": "04216", // 富谷町 -> 富谷市
  "11445": "11246", // 白岡町 -> 白岡市
  "12402": "12239", // 大網白里町 -> 大網白里市
  "17344": "17212", // 野々市町 -> 野々市市
  "23304": "23238", // 長久手町 -> 長久手市
  "40305": "40231", // 那珂川町 -> 那珂川市
  // 浜松市の区の再編（2024年）: 中央区は旧中区役所、浜名区は旧浜北区役所の場所
  "22131": "22138", // 中区 -> 中央区
  "22136": "22139", // 浜北区 -> 浜名区
  "22137": "22140", // 天竜区
};

export type LngLat = [number, number];

export interface ResolvedOffices {
  offices: Record<string, LngLat>;
  /** 庁舎の位置が決まらなかった市区町村コード */
  missing: string[];
}

/** 市区町村コードの一覧に対して、庁舎の位置（[経度, 緯度]）を決める */
export function resolveOffices(
  codes: readonly string[],
  p05: readonly OfficeSource[],
  extra: Readonly<Record<string, ExtraOffice>>,
): ResolvedOffices {
  const byCode = new Map<string, LngLat>();
  for (const o of p05) if (!byCode.has(o.code)) byCode.set(o.code, [o.lon, o.lat]);
  for (const [oldCode, newCode] of Object.entries(SUCCESSORS)) {
    const p = byCode.get(oldCode);
    if (p && !byCode.has(newCode)) byCode.set(newCode, p);
  }
  for (const [code, o] of Object.entries(extra)) byCode.set(code, [o.lon, o.lat]);

  const offices: Record<string, LngLat> = {};
  const missing: string[] = [];
  for (const code of [...codes].sort()) {
    const p = byCode.get(code);
    if (p) offices[code] = p;
    else missing.push(code);
  }
  return { offices, missing };
}
