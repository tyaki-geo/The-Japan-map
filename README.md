# The Japan Map

TypeScript + Vite の Web アプリ。国土地理院の基盤地図情報（行政区画・町字界）を都道府県・市区町村単位に整理し、MapLibre GL JS で表示する。

公開ページ: https://tyaki-geo.github.io/The-Japan-map/

## 機能
GeoGuessr の練習用の地図アプリ。

- 勉強モード
  - 都道府県・市区町村の境界表示（都道府県ごとに色分け）
  - 一覧・地図クリック・検索（名称／団体コード）で市区町村を選択し、詳細境界・情報を表示
  - 選択中の市区町村の町・大字（丁目をまとめた単位）の区域と名称を表示（ズーム11以上で名称）
  - レイヤの表示切替、URL ハッシュ（例 `#38201`）で選択状態を共有
- クイズ（看板風に出した地名を見て、その場所を地図でクリックして答える）
  - 市区町村当て / 地名当て（町・大字がある市区町村を答える）/ ミックス
  - 文字の見え方: 通常 / 文字欠け（1文字を ○×△□ などに置き換え）/ モザイク（濃さを調整でき、新宿区でプレビュー）
  - 答え合わせで正解の場所と、クリックした位置からの距離を表示

データの形式は [data/README.md](data/README.md) を参照。

## 構成
- `data/raw` 元データ / `data/edited` 加工済みデータ / `data/converter` 変換コード (Rust)
- `scripts/` 補助スクリプト (tsx。data/edited を public/data へコピー)
- `src/` アプリ本体 (`lib/` ロジック, `types/` 型)
- `tests/` テスト (vitest)
- `docs/` 仕様メモ
- `.github/workflows/` CI と GitHub Pages デプロイ

## コマンド
```
npm install
npm run data:process   # data/raw の zip -> data/edited（Rust が必要）
npm run dev
npm test
npm run build
cargo test --manifest-path data/converter/Cargo.toml
```

開発の進め方・地区割の方法は [CLAUDE.md](CLAUDE.md) を参照。
