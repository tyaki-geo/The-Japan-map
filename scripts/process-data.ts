// data/raw -> data/edited の加工パイプライン（仕様確定後に実装）
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw");

const files = (await readdir(rawDir)).filter((f) => !f.startsWith("."));
console.log(`raw files: ${files.length}`);
