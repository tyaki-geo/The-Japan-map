import type { DatasetIndex, MunicipalityEntry } from "../types";

// data/edited は scripts/sync-data.ts により public/data/ へコピーされる
export function dataUrl(name: string): string {
  return new URL(`${import.meta.env.BASE_URL}data/${name}`, window.location.href).href;
}

export async function loadDataset<T = unknown>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadIndex(): Promise<DatasetIndex> {
  return loadDataset<DatasetIndex>("index.json");
}

export function municipalityFile(m: MunicipalityEntry, file: "boundary.geojson" | "towns.geojson"): string {
  return `${m.dir}/${file}`;
}
