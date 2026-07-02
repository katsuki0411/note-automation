import type { ImageSpec } from "./types";

// =========================================================
// 本文画像指示のパース / アスペクト比正規化 / 生成プロンプト組立 (2026-07-01)
// =========================================================
// フェーズ3出力の「③画像生成指示」ブロックを構造化し、本文中の [IMG-NN] マーカーと
// 突き合わせる。server/client 双方から使えるよう純関数のみ (DB/SDK 非依存)。
// =========================================================

// 本文中の画像マーカー: [IMG-00｜説明] / [IMG-1|desc] / [IMG-12] 等。
// 全角パイプ(｜)・半角パイプ(|)どちらの区切りも許容。
const BODY_MARKER_RE = /\[\s*IMG[-\s]?(\d+)\s*(?:[｜|]\s*([^\]]*))?\]/gi;

/** marker 番号を "IMG-00" 形式に正規化 (元の桁数・ゼロ埋めを保持)。 */
function normalizeMarker(num: string): string {
  return `IMG-${num}`;
}

/**
 * 本文から [IMG-NN｜説明] マーカーを拾い、marker → 説明 のマップを返す。
 * 説明は altText の第一候補になる。
 */
export function extractBodyMarkerLabels(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(BODY_MARKER_RE)) {
    const marker = normalizeMarker(m[1]);
    const label = (m[2] ?? "").trim();
    if (!map.has(marker) || (label && !map.get(marker))) {
      map.set(marker, label);
    }
  }
  return map;
}

/** 本文に出現する marker を出現順で返す (重複排除)。 */
export function extractBodyMarkers(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(BODY_MARKER_RE)) {
    const marker = normalizeMarker(m[1]);
    if (!seen.has(marker)) {
      seen.add(marker);
      out.push(marker);
    }
  }
  return out;
}

export type BodySegment =
  | { type: "text"; text: string }
  | { type: "marker"; marker: string; label: string };

/**
 * 本文を [IMG-NN｜説明] マーカーで分割し、テキストとマーカーの列にする。
 * UI でマーカー位置に画像カードを差し込むために使う。
 */
export function splitBodyByMarkers(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  const re = new RegExp(BODY_MARKER_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) {
      segments.push({ type: "text", text: body.slice(last, m.index) });
    }
    segments.push({
      type: "marker",
      marker: normalizeMarker(m[1]),
      label: (m[2] ?? "").trim(),
    });
    last = re.lastIndex;
  }
  if (last < body.length) {
    segments.push({ type: "text", text: body.slice(last) });
  }
  return segments;
}

const FIELD_KEYS = [
  "marker",
  "role",
  "placement",
  "purpose",
  "type",
  "aspect_ratio",
  "style",
  "text_in_image",
  "prompt",
  "negative",
] as const;

const KEY_RE = new RegExp(
  `^\\s*(${FIELD_KEYS.join("|")})\\s*[:：]\\s*(.*)$`,
  "i",
);

const DELIM_RE = /[-‐‑–—―]{3,}\s*IMG[-\s]?(\d+)\s*[-‐‑–—―]{3,}/gi;

function parseSegment(
  num: string,
  seg: string,
  bodyLabels?: Map<string, string>,
): ImageSpec {
  const fields: Record<string, string> = {};
  let cur: string | null = null;
  for (const line of seg.split("\n")) {
    const m = line.match(KEY_RE);
    if (m) {
      cur = m[1].toLowerCase();
      fields[cur] = m[2].trim();
    } else if (cur) {
      const t = line.trim();
      // 次のブロック区切りや装飾行は無視
      if (t && !/^[=＝]{3,}/.test(t)) {
        fields[cur] += (fields[cur] ? " " : "") + t;
      }
    }
  }

  const marker = normalizeMarker(num);
  // aspect_ratio の値から比率パターンだけ抜く (「1.91:1（note見出し...）」→「1.91:1」)
  const arMatch = (fields.aspect_ratio ?? "").match(/(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/);
  const aspectRatio = arMatch ? `${arMatch[1]}:${arMatch[2]}` : undefined;

  const bodyLabel = bodyLabels?.get(marker);
  const altText =
    (bodyLabel && bodyLabel.trim()) || fields.purpose || fields.placement || undefined;

  // prompt が空なら他フィールドから最低限を合成 (生成が空プロンプトにならないように)
  const prompt =
    fields.prompt ||
    [fields.purpose, fields.type, fields.style].filter(Boolean).join("、") ||
    marker;

  return {
    marker,
    role: fields.role || undefined,
    placement: fields.placement || undefined,
    purpose: fields.purpose || undefined,
    type: fields.type || undefined,
    aspectRatio,
    style: fields.style || undefined,
    textInImage: fields.text_in_image || undefined,
    prompt,
    negative: fields.negative || undefined,
    altText,
  };
}

/**
 * フェーズ3の生出力から「③画像生成指示」ブロックを探し、各 [IMG-NN] を構造化する。
 * bodyLabels を渡すと altText を本文マーカーの説明から補完する。
 * ブロックが無ければ空配列。
 */
export function parseImageSpecsFromPhase3(
  raw: string,
  bodyLabels?: Map<string, string>,
): ImageSpec[] {
  const start = raw.search(/={4,}\s*画像生成指示|[―—\-‐‑–]{2,}\s*③|画像生成指示（システム用/);
  if (start < 0) return [];
  const block = raw.slice(start);

  const marks: { num: string; end: number; idx: number }[] = [];
  DELIM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DELIM_RE.exec(block))) {
    marks.push({ num: m[1], idx: m.index, end: DELIM_RE.lastIndex });
  }
  if (marks.length === 0) return [];

  const specs: ImageSpec[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < marks.length; i++) {
    const seg = block.slice(
      marks[i].end,
      i + 1 < marks.length ? marks[i + 1].idx : block.length,
    );
    const spec = parseSegment(marks[i].num, seg, bodyLabels);
    if (seen.has(spec.marker)) continue; // 同一マーカー重複はスキップ
    seen.add(spec.marker);
    specs.push(spec);
  }
  return specs;
}

/**
 * spec が「見出し画像(アイキャッチ)」かどうか。
 * placement/role/purpose に アイキャッチ/見出し を含む、または marker が IMG-00。
 * それ以外は本文画像として扱う。
 */
export function isHeaderSpec(spec: ImageSpec): boolean {
  // 「セクション見出し下」等の本文画像を誤判定しないよう、
  // 「アイキャッチ」または「見出し画像」(≠ 単なる「見出し」) に限定する。
  const hay = `${spec.placement ?? ""} ${spec.role ?? ""} ${spec.purpose ?? ""}`;
  if (/アイキャッチ|見出し画像/.test(hay)) return true;
  return spec.marker === "IMG-00";
}

/** specs を 見出し(先頭1件) / 本文 に振り分ける。 */
export function splitHeaderAndBodySpecs(specs: ImageSpec[]): {
  header?: ImageSpec;
  body: ImageSpec[];
} {
  let header: ImageSpec | undefined;
  const body: ImageSpec[] = [];
  for (const s of specs) {
    if (!header && isHeaderSpec(s)) header = s;
    else body.push(s);
  }
  return { header, body };
}

// gemini-2.5-flash-image がサポートするアスペクト比と数値。
const SUPPORTED_RATIOS: { label: string; value: number }[] = [
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

/**
 * 「1.91:1」のような任意比率を、SDK が受け付ける最も近い比率へ丸める。
 * 解釈できなければ 16:9 (本文画像の既定)。
 */
export function normalizeAspectRatio(input?: string | null): string {
  if (!input) return "16:9";
  const m = input.match(/(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/);
  if (!m) return "16:9";
  const target = parseFloat(m[1]) / parseFloat(m[2]);
  if (!isFinite(target) || target <= 0) return "16:9";
  let best = SUPPORTED_RATIOS[0];
  let bestDiff = Infinity;
  for (const r of SUPPORTED_RATIOS) {
    const diff = Math.abs(r.value - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best.label;
}

// 画像の統一ハウススタイル。著者spec が「写真」等を指定していても、
// 絵柄はこの水彩風イラストに統一する（ブランドの見た目維持）。
export const HOUSE_IMAGE_STYLE =
  "水彩風イラスト、柔らかい手描きの線、パステルカラー（淡いピンク・ベージュ・ミントグリーン）、" +
  "朝の自然光、温かみのある雰囲気。写実的な写真・3DCG・実写ではなく、必ず手描き風の水彩イラストで描く。";

/**
 * ImageSpec から画像生成用プロンプトを組み立てる。
 * 絵柄はハウス水彩スタイルを最優先（spec.type=写真 等より優先）。
 * opts.noText=true のときは「文字なしの水彩イラスト」を生成させる
 * （タイトルは後段でコード合成するため。Nano Banana の日本語文字化け対策）。
 */
// noText 時に、著者prompt から「文字・タイトルを描け」という指示文を取り除く。
// (これを残すと Gemini が文字を描いてしまい、後段のオーバーレイと二重になる)
function stripTextInstructions(prompt: string): string {
  const kept = prompt
    .split(/(?<=。)/)
    .filter((s) => !/(タイトル|文字|テキスト|文言|ゴシック|フォント|英語化|誤字|キャプション|ロゴ|描画)/.test(s))
    .join("")
    .trim();
  return kept || prompt;
}

export function buildMarkerImagePrompt(
  spec: ImageSpec,
  opts?: { noText?: boolean },
): string {
  const lines: string[] = [];
  lines.push(`絵柄（最優先・厳守）: ${HOUSE_IMAGE_STYLE}`);
  const scene = opts?.noText ? stripTextInstructions(spec.prompt) : spec.prompt;
  lines.push("", `描く内容: ${scene}`);

  const negParts = ["写真風のリアルな質感、実写、3DCG、CG、硬い輪郭、暗い色調"];
  if (opts?.noText) {
    lines.push(
      "",
      "画像内に文字・ロゴ・タイトル・キャプションは一切入れないこと。",
      "構図（重要）: 主役の被写体（商品・手元・人物など）は画面の中央〜下寄りに配置し、" +
        "上部およそ40%はタイトル文字を載せるための余白（淡い空・壁・ぼかした背景）だけにして、被写体を上部に重ねない。",
    );
    negParts.push("文字、テキスト、ロゴ、日本語、英語、数字、キャプション、透かし");
  } else if (spec.textInImage && !/^なし/.test(spec.textInImage.trim())) {
    lines.push("", `画像内に入れる文字: ${spec.textInImage}`);
    lines.push(
      "",
      "画像内に文字を入れる場合はすべて日本語。指定文言を一字一句そのまま、読みやすい日本語フォント（丸ゴシック等）で大きく正確に描画。英語化・文字化け・崩れた文字・誤字を厳禁。",
    );
  }

  const neg = [spec.negative, ...negParts].filter(Boolean).join("、");
  lines.push("", `避ける要素: ${neg}`);
  return lines.join("\n").trim();
}

/**
 * 見出し画像にオーバーレイするタイトル文字を決める。
 * spec.textInImage の「…」内テキストを優先、無ければ fallback(記事タイトル)。
 */
export function extractOverlayText(
  spec: ImageSpec | undefined,
  fallback: string,
): string {
  let t = spec?.textInImage?.trim();
  if (!t || /^なし/.test(t)) return fallback;
  // 「あり：」「あり:」等の接頭辞を除去
  t = t.replace(/^あり\s*[:：]?\s*/, "").trim();
  // 最外の 「…」/『…』 でくるまれていれば剥がす (内側の鉤括弧は保持)
  const m = t.match(/^[「『]([\s\S]+)[」』]$/);
  if (m) t = m[1].trim();
  return t || fallback;
}
