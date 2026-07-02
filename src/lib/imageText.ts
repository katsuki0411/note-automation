import "server-only";
import path from "node:path";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

// =========================================================
// 見出し画像へのタイトル文字オーバーレイ (2026-07-02)
// =========================================================
// Gemini(Nano Banana) は日本語テキストの描画が苦手で文字化けする。
// そこで画像は「文字なしの水彩イラスト」を生成し、タイトルはこのモジュールで
// 本物の日本語フォント(M PLUS Rounded 1c)を使って正確に合成する。
// =========================================================

const FONT_FAMILY = "MPLUSRounded1c";
let fontReady = false;

function ensureFont(): void {
  if (fontReady) return;
  const fontPath = path.join(process.cwd(), "assets", "fonts", "MPLUSRounded1c-Bold.woff2");
  GlobalFonts.registerFromPath(fontPath, FONT_FAMILY);
  fontReady = true;
}

// テキストを maxWidth に収まるよう文字単位で折り返す (日本語は空白が無いので字送り)。
function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(cur);
      cur = "";
      continue;
    }
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// maxLines に収まる最大のフォントサイズと行分割を求める。
function fitText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  minSize: number,
): { size: number; lines: string[] } {
  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `bold ${minSize}px ${FONT_FAMILY}`;
  return { size: minSize, lines: wrapText(ctx, text, maxWidth).slice(0, maxLines) };
}

/**
 * 水彩イラスト(base64 PNG)の上部にタイトル文字を合成して base64 PNG を返す。
 * - 上部に半透明の白い帯を敷き、その上に丸ゴシックでタイトルを中央寄せ描画。
 * - 文字色は水彩の温かみに合わせた濃いブラウン。
 */
export async function overlayTitle(
  base64Png: string,
  title: string,
): Promise<string> {
  const text = title.trim();
  if (!text) return base64Png;
  ensureFont();

  const img = await loadImage(Buffer.from(base64Png, "base64"));
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const maxWidth = w * 0.86;
  const { size, lines } = fitText(ctx, text, maxWidth, 3, Math.round(w * 0.058), Math.round(w * 0.03));
  const lineHeight = Math.round(size * 1.35);
  const blockHeight = lines.length * lineHeight;

  // 上部の帯 (半透明の白)。テキストブロックに上下パディングを付ける。
  const padY = Math.round(size * 0.6);
  const bandHeight = blockHeight + padY * 2;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, bandHeight);
  ctx.restore();

  // テキスト (中央寄せ・濃いブラウン・薄い縁取りで可読性UP)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${size}px ${FONT_FAMILY}`;
  const cx = w / 2;
  const firstY = padY + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = firstY + i * lineHeight;
    ctx.lineWidth = Math.max(2, Math.round(size * 0.08));
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.strokeText(lines[i], cx, y);
    ctx.fillStyle = "#6f5040";
    ctx.fillText(lines[i], cx, y);
  }

  return canvas.toBuffer("image/png").toString("base64");
}
