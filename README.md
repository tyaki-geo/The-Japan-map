# The Japan Map

TypeScript + Vite の Web アプリ。国土地理院の基盤地図情報（行政区画・町字界）を都道府県・市区町村単位に整理し、MapLibre GL JS と地理院タイルで表示する。

## 機能
- 都道府県・市区町村の境界表示（都道府県ごとに色分け）
- 一覧・地図クリック・検索（名称／団体コード）で市区町村を選択し、詳細境界・情報を表示
- 選択中の市区町村の町字界線と大字・町・丁目の代表点（ズーム12以上で名称）を表示
- レイヤの表示切替、URL ハッシュ（例 `#38201`）で選択状態を共有

データの形式は [data/README.md](data/README.md) を参照。

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
npm run data:process   # data/raw の zip -> data/edited
npm run dev
npm test
npm run build
```
