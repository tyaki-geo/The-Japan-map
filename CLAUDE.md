# CLAUDE.md

国土地理院の基盤地図情報（GML）を都道府県 → 市区町村 → 町・大字の階層に整理し、地図で表示する Web アプリ。
公開先: https://tyaki-geo.github.io/The-Japan-map/

## コマンド

```
npm run data:process   # data/raw の zip -> data/edited（加工）
npm run dev            # data/edited -> public/data へ同期して開発サーバ
npm run typecheck && npm test && npm run build
```

## リポジトリの運用

- main はルールセット（`.github/protect-main.json`）で保護されている。直接 push せず、ブランチを切って PR を出す。レビューは CODEOWNERS（`@tyaki-geo`）
- push は SSH の `tyaki` ホスト（`git@tyaki:tyaki-geo/The-Japan-map.git`）。gh CLI のアカウント（24-fuji）はこのリポジトリに読み取り権限しかない
- `data/raw/` は git 管理外（zip を置くだけ）。`data/edited/` はコミットする（Pages のビルドがこれを使う）
- 依存パッケージは公開から2週間以上経った版を `--save-exact` で固定する

## 構成

- `scripts/process-data.ts` 加工パイプライン本体
- `scripts/lib/fgd.ts` FG-GML の XML → GeoJSON 変換（緯度経度の入れ替えを含む）
- `scripts/lib/towns.ts` 町・大字名の決め方（丁目の除去）
- `scripts/lib/prefectures.ts` 都道府県コード → 名称
- `src/types/index.ts` data/edited の型（スクリプトとアプリで共有）
- `src/map.ts` MapLibre の地図とレイヤ、`src/sidebar.ts` 一覧・検索・情報パネル
- 出力形式の詳細は `data/README.md`

## 入力データ

- ファイル名 `FG-GML-{2次メッシュ}-{項目番号}-{日付}.zip`。同じメッシュ・項目は日付の新しいものだけ使う。`:Zone.Identifier` などは無視
- 使う項目
  - `05` 行政区画: `AdmArea`（市区町村ポリゴン。**2次メッシュの縁で切れている**）、属性 `name` / `admCode` / `type`
  - `12` 町字界: `CommBdry`（境界**線**のみ）のうち type が `大字・町・丁目界` のもの、`CommPt`（大字・町・丁目の代表点、`name` / `admCode`）
- 座標は JGD2024 緯度経度で、GML は「緯度 経度」の順。GeoJSON では [経度, 緯度] に入れ替える
- 精度が違う: 行政区画は 1/25000 相当、町字界は 1/2500 相当。線の端が市区町村界にぴったり乗らない
- `12` があるのは都市計画区域などの一部メッシュだけ。同じ市区町村でも町字データの無い範囲がある

## 地区割の方法

### 都道府県・市区町村

1. 全メッシュの `AdmArea` を `admCode`（5桁の団体コード）ごとに mapshaper `-dissolve` で統合する。メッシュの縁の辺は両側で座標が一致するので、普通の dissolve で継ぎ目なく消える（dissolve2 は不要）
2. 面積は mapshaper の `this.area`（球面上の面積、m²）から km² に直す。収録したメッシュの範囲内の値になる
3. ラベル位置は `-points inner`
4. 全体表示用は `-simplify interval=30 keep-shapes` で簡略化する。トポロジーを保つので隣の市区町村との間に隙間はできない
5. 都道府県は団体コード上2桁で、簡略化済みの市区町村をさらに dissolve する

### 町・大字（市区町村の1段下）

町字界は線と点しかないので、区域を組み立ててから名前でまとめる。

1. **線の振り分け**: 町字界線の頂点を、中央から順に見ていき、最初に入っていた市区町村に割り当てる。湾内など陸域ポリゴンの外にしか頂点が無い線は、端点を共有する割り当て済みの線と同じ市区町村にする（端点の座標が一致するものをたどり、変化がなくなるまで繰り返す）
2. **代表点の振り分け**: `admCode` で割り当てる。`00000` など該当しないコードは、点がどのポリゴンに入るかで決める
3. **区域の組み立て**（市区町村ごと）: 町字界線と市区町村ポリゴンの外周線を1つのレイヤにして mapshaper `-polygons` で区域にし、`-clip` で市区町村ポリゴンの内側だけ残して `-explode`。gap-tolerance は指定しない（試した範囲で結果が変わらなかった）
4. **名前付け**: 区域に入る代表点の名称から丁目番号だけを除いて名前にする（`townGroupName`）
   - 除くのは末尾の `(数字|漢数字)丁目` だけ。正規表現 `/(?:[0-9０-９]+|[一二三四五六七八九十]+)丁目$/`
   - 例: 枝松一丁目 → 枝松、別当５丁目 → 別当
   - **甲・乙・丙や東西南北、本町・新町などはそのまま残す**（朝倉甲・朝倉乙は別の区域、余戸中・余戸南も別）。これはユーザーの方針
   - 1つの区域に複数の名前が入っていたら最も多いものにする。同数なら先に出たもの（`pickGroupName`）
5. **統合**: 同じ名前の区域を `-dissolve fields=name sum-fields=count` でまとめる。名前の位置は `-points inner`
6. 代表点を含まない区域（町字データの無い範囲、精度差による細片）は出力しない

結果（愛媛・高知とその周辺のテストデータ）: 代表点1927件 → 1023区域、区域に入らなかった代表点は1件。

### 分かっている限界

- 元データで境界線が1本欠けていると、隣の町と1つの区域になる（例: 松山市の三津三丁目が「三津ふ頭」の区域に入る）
- 町字データが無い範囲（例: 松山市の中島など）は町・大字の区域が無い

## 実装上の注意（ハマりどころ）

- mapshaper
  - `-dissolve name` と書くと `name` がオプションとして解釈される。項目名は `fields=name` と明示する
  - 属性の無いレイヤを GeoJSON 出力すると GeometryCollection になる。`geojson-type=FeatureCollection` を付ける
  - `-clip` の後は geometry が null の地物が混ざるので読み込み側で除く
  - `-dissolve` で作ったレイヤは名前が引き継がれないので、後で `target=` で使うなら `name=` を付ける
  - mapshaper には型定義が無いので `scripts/mapshaper.d.ts` で宣言している
- MapLibre GL v6
  - Vite でバンドルすると Worker の URL が解決できず地図が出ない。`maplibre-gl/dist/maplibre-gl-worker.mjs?url` を `setWorkerUrl` に渡している
  - スタイルの `glyphs` を省略し、ブラウザのフォントで文字を描いている（外部フォントサーバ不要）
- 背景は地理院タイル「白地図」（`/xyz/blank/`）。ズーム5〜14のみなので source の `maxzoom: 14` で引き伸ばしている
- Vite の既定のビルドターゲットではトップレベル await が使えない（`src/main.ts` は async 関数で包んでいる）

## 全国データに広げるときの検討事項

今は全データを1回で読み、全 `AdmArea` を1つの GeoJSON 文字列にして mapshaper に渡している。テストデータ（265 zip、約19MB）で約20秒、出力は約28MB。全国では次の点が問題になりうる。

- メモリと時間: 全 `AdmArea` を1つにまとめると巨大になる。都道府県ごと（団体コード上2桁）に分けて処理し、都道府県界をまたぐ統合だけ最後に行う形が候補。ただし1つの2次メッシュに複数の都道府県が入るので、メッシュ単位では分けられない
- 出力サイズ: GitHub Pages の公開サイトは 1GB まで、git の1ファイルは 100MB まで。全体表示用の `municipalities.geojson` を1ファイルで配るのは重くなるので、ベクトルタイル（PMTiles など）や都道府県ごとの分割を検討する
- `data/edited` をコミットし続けるとリポジトリが肥大化する。Actions 側で加工する、別の置き場を使う、なども選択肢
- 町・大字の組み立ては市区町村ごとに独立しているので、並列化しやすい
