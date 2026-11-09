// data/sources の庁舎データから data/edited/offices.json（市区町村コード -> [経度, 緯度]）を作る
// 使い方: npm run data:offices（data/edited/index.json が必要。先に npm run data:process を実行しておく）
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveOffices, type ExtraOffice, type OfficeSource } from "./offices";
import type { DatasetIndex } from "../src/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async <T>(file: string) => JSON.parse(await readFile(path.join(root, file), "utf8")) as T;

const index = await readJson<DatasetIndex>("data/edited/index.json");
const p05 = await readJson<OfficeSource[]>("data/sources/offices-p05.json");
const extra = await readJson<Record<string, ExtraOffice>>("data/sources/offices-extra.json");

const codes = index.prefectures.flatMap((p) => p.municipalities.map((m) => m.code));
const { offices, missing } = resolveOffices(codes, p05, extra);
await writeFile(path.join(root, "data/edited/offices.json"), JSON.stringify(offices) + "\n");

const names = new Map(index.prefectures.flatMap((p) => p.municipalities.map((m) => [m.code, m.name] as const)));
console.log(`offices.json: ${Object.keys(offices).length} / ${codes.length} 市区町村`);
if (missing.length > 0) console.log(`庁舎なし: ${missing.map((c) => `${c} ${names.get(c)}`).join(", ")}`);
