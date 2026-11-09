// data/sources の市外局番の一覧から data/edited/area-codes.json（市外局番 -> 市区町村コード）を作る
// 使い方: npm run data:area-codes（data/edited/index.json が必要。先に npm run data:process を実行しておく）
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildAreaCodes, buildResolver, parseAreaEntries, type District } from "./areacode";
import type { DatasetIndex } from "../src/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

const index = JSON.parse(await read("data/edited/index.json")) as DatasetIndex;
const districts = JSON.parse(await read("data/sources/districts-n03.json")) as District[];
const entries = parseAreaEntries(await read("data/sources/area-codes.tsv"));

const resolver = buildResolver(index.prefectures, districts);
const { areaCodes, unresolved } = buildAreaCodes(entries, resolver);

const count = Object.keys(areaCodes).length;
console.log(`区画 ${entries.length} 件 -> 市外局番 ${count} 種、当てはまらなかった項目 ${unresolved.length} 件`);
for (const u of unresolved) console.log(`  区画 ${u.block}（${u.areaCode}）: ${u.item}`);
if (unresolved.length > 0) {
  console.error("当てはまらない項目があるので書き出しません。scripts/areacode.ts を直してください");
  process.exit(1);
}
await writeFile(path.join(root, "data/edited/area-codes.json"), JSON.stringify(areaCodes) + "\n");
console.log("wrote data/edited/area-codes.json");
