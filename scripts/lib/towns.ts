// 町字（大字・町・丁目）の名称を市区町村の1段下のまとまり（丁目を除いた町・大字）に寄せる

const CHOME = /(?:[0-9０-９]+|[一二三四五六七八九十]+)丁目$/;

/** 「枝松三丁目」「別当５丁目」→「枝松」「別当」。丁目でなければそのまま */
export function townGroupName(name: string): string {
  const base = name.trim().replace(CHOME, "");
  return base || name.trim();
}

/** 1つの区域に含まれる代表点の名称から、その区域のまとまり名を決める（最多のもの、同数なら先に出たもの） */
export function pickGroupName(names: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    const g = townGroupName(n);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [g, c] of counts) if (best === undefined || c > counts.get(best)!) best = g;
  return best;
}
