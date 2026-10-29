// data/edited は scripts/sync-data.ts により public/data/ へコピーされる
export async function loadDataset<T = unknown>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return (await res.json()) as T;
}
