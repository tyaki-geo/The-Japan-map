// data/edited の形式（scripts/process-data.ts が生成し、アプリが読み込む）

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export interface MunicipalityEntry {
  /** 全国地方公共団体コード（5桁、検査数字なし） */
  code: string;
  name: string;
  /** 基盤地図情報の種別（郡市・東京都の区 / 町村・指定都市の区） */
  type: string;
  /** 収録範囲内の面積 [km²] */
  areaKm2: number;
  bbox: BBox;
  /** ラベル表示用の代表点 [経度, 緯度] */
  center: [number, number];
  /** 町・大字の区域データ（towns.geojson）があるか */
  hasTowns: boolean;
  /** 町・大字（丁目をまとめた単位）の数 */
  townCount: number;
  /** data/edited からの相対パス */
  dir: string;
}

export interface PrefectureEntry {
  code: string;
  name: string;
  bbox: BBox;
  municipalities: MunicipalityEntry[];
}

export interface DatasetIndex {
  generatedAt: string;
  source: {
    name: string;
    url: string;
    /** 収録している2次メッシュ番号 */
    meshes: string[];
    /** 収録しているアーカイブ（項目番号ごとのファイル数） */
    items: Record<string, number>;
  };
  prefectures: PrefectureEntry[];
}

/** municipalities.geojson / boundary.geojson の地物属性 */
export interface MunicipalityProps {
  code: string;
  name: string;
  type: string;
  prefCode: string;
  prefName: string;
}

/** prefectures.geojson の地物属性 */
export interface PrefectureProps {
  prefCode: string;
  prefName: string;
}

/**
 * towns.geojson の地物属性
 * - area : 町・大字の区域（丁目は統合済み）。count は元の大字・町・丁目の数
 * - label: 区域内の名称表示位置
 */
export type TownProps = { kind: "area"; name: string; count: number } | { kind: "label"; name: string };
