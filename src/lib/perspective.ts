// 看板を縦の軸まわりに回し（ヨー角）、横から見たときにカメラへどう映るかを計算する。
//
// 看板の中心を原点、看板上の横位置を u（左端 -W/2 〜 右端 +W/2）とする。看板をθ回すと、
// その点はカメラから見て横 X = u·cosθ、奥行 Z = d + u·sinθ の位置に来る（d は看板の中心までの距離）。
// 焦点距離を d とすると、画面上の横位置は x = d·X / Z、縦の倍率は d / Z になる。
// 縦の軸で回すので看板の縦線は縦のまま映る。そこで画面の列ごとに、看板のどの列が何倍で映るかを求める。

/** 画面の1列に映る看板の列 */
export interface ColumnMap {
  /** 看板上の横位置 [px]（0 〜 width） */
  srcX: number;
  /** 縦の倍率（1 で元の高さ） */
  scaleY: number;
}

/** カメラから看板の中心までの距離（看板の幅に対する倍率）。小さいほど遠近感が強い */
export const CAMERA_DISTANCE_RATIO = 1.6;

/**
 * 幅 `width`・高さ `height` [px] の看板をヨー角 `yawDeg` 度で見たとき、
 * 同じ大きさの画面の各列（左から）に映る看板の列。看板が映らない列は null。
 * 全体が画面に収まるよう縮める（正面なら等倍）
 */
export function projectYaw(width: number, height: number, yawDeg: number): (ColumnMap | null)[] {
  const half = width / 2;
  const d = width * CAMERA_DISTANCE_RATIO;
  const theta = (yawDeg * Math.PI) / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  const projX = (u: number) => (d * u * c) / (d + u * s);
  const scale = (u: number) => d / (d + u * s);
  // 近い側の端が画面からはみ出さないよう、全体を縮める倍率
  const fitX = half / Math.max(Math.abs(projX(-half)), Math.abs(projX(half)));
  const fitY = 1 / Math.max(scale(-half), scale(half));
  const k = Math.min(1, fitX, fitY);

  return Array.from({ length: Math.round(width) }, (_, i) => {
    const x = (i + 0.5 - half) / k;
    const denom = d * c - x * s;
    if (denom <= 0) return null;
    const u = (x * d) / denom;
    if (u < -half || u > half) return null;
    return { srcX: u + half, scaleY: k * scale(u) };
  });
}

/** 看板の高さ `height` と縦の倍率から、画面上で映る縦の範囲 [上端, 高さ]（中央そろえ） */
export function columnSpan(height: number, scaleY: number): [number, number] {
  const h = height * scaleY;
  return [(height - h) / 2, h];
}
