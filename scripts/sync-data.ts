// data/edited を public/data へコピーし、アプリから配信できるようにする
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "data", "edited");
const dest = path.join(root, "public", "data");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`synced ${src} -> ${dest}`);
