import type { DatasetIndex, MunicipalityEntry, PrefectureEntry } from "../types";

// カタカナをひらがなに寄せ、全角英数を半角にして比較する
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .trim();
}

/**
 * 名称またはコードで市区町村を絞り込む。
 * 都道府県名に一致した場合はその都道府県の市区町村をすべて返す。
 */
export function filterPrefectures(index: DatasetIndex, query: string): PrefectureEntry[] {
  const q = normalize(query);
  if (!q) return index.prefectures;
  return index.prefectures
    .map((pref) => {
      if (normalize(pref.name).includes(q) || pref.code === q) return pref;
      const municipalities = pref.municipalities.filter(
        (m) => normalize(m.name).includes(q) || m.code.startsWith(q),
      );
      return { ...pref, municipalities };
    })
    .filter((pref) => pref.municipalities.length > 0);
}

export function findMunicipality(index: DatasetIndex, code: string): MunicipalityEntry | undefined {
  for (const pref of index.prefectures) {
    const m = pref.municipalities.find((m) => m.code === code);
    if (m) return m;
  }
  return undefined;
}
