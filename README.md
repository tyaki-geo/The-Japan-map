# The Japan Map

TypeScript + Vite の Web アプリ。

## 構成
- `data/raw` 元データ / `data/edited` 加工済みデータ
- `scripts/` データ加工スクリプト (tsx)
- `src/` アプリ本体 (`lib/` ロジック, `types/` 型)
- `tests/` テスト (vitest)
- `docs/` 仕様メモ
- `.github/workflows/` CI と GitHub Pages デプロイ

## コマンド
```
npm install
npm run dev
npm run data:process
npm test
npm run build
```
