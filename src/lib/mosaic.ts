// 手がかりの地名を看板風に描く。モザイクは文字を描いた画像を縮小し、ぼかさずに拡大してかける

export interface SignOptions {
  /** 看板の幅・高さ [CSS px] */
  width: number;
  height: number;
  /** 文字の高さに対するモザイク1マスの大きさの割合。省略するとモザイクなし */
  mosaicRatio?: number;
}

const SIGN_BG = "#1f5f9e";
const SIGN_FG = "#ffffff";
const FONT_FAMILY = `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif`;

/** `canvas` に地名の看板を描く（高解像度ディスプレイに合わせて画素数を決める） */
export function drawSign(canvas: HTMLCanvasElement, text: string, opts: SignOptions) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(opts.width * dpr);
  canvas.height = Math.round(opts.height * dpr);
  canvas.style.width = `${opts.width}px`;
  canvas.style.height = `${opts.height}px`;

  // 文字が看板に収まる大きさを決める
  const ctx = canvas.getContext("2d")!;
  const pad = canvas.height * 0.18;
  let fontPx = canvas.height * 0.5;
  ctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;
  const textWidth = ctx.measureText(text).width;
  if (textWidth > canvas.width - pad * 2) fontPx *= (canvas.width - pad * 2) / textWidth;

  const sign = document.createElement("canvas");
  sign.width = canvas.width;
  sign.height = canvas.height;
  const sctx = sign.getContext("2d")!;
  sctx.fillStyle = SIGN_BG;
  sctx.fillRect(0, 0, sign.width, sign.height);
  sctx.strokeStyle = SIGN_FG;
  sctx.lineWidth = Math.max(2, canvas.height * 0.03);
  sctx.strokeRect(pad / 3, pad / 3, sign.width - (pad * 2) / 3, sign.height - (pad * 2) / 3);
  sctx.fillStyle = SIGN_FG;
  sctx.font = `bold ${fontPx}px ${FONT_FAMILY}`;
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillText(text, sign.width / 2, sign.height / 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (opts.mosaicRatio === undefined) {
    ctx.drawImage(sign, 0, 0);
    return;
  }
  const block = Math.max(1, fontPx * opts.mosaicRatio);
  const cols = Math.max(1, Math.round(canvas.width / block));
  const rows = Math.max(1, Math.round(canvas.height / block));
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const smallCtx = small.getContext("2d")!;
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(sign, 0, 0, cols, rows);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
}
