"use client";

import { splitBodyByMarkers, isHeaderSpec } from "@/lib/imageSpecs";
import type { ImageSpec } from "@/lib/types";

export type MarkerImageState = {
  state: "idle" | "loading" | "error" | "done";
  dataUrl?: string;
  error?: string;
};

// 本文を [IMG-NN] マーカーで分割し、各マーカー位置に画像生成カードを差し込んで表示する。
export default function ArticleBody({
  body,
  specs,
  images,
  onGenerate,
}: {
  body: string;
  specs: ImageSpec[];
  images: Record<string, MarkerImageState>;
  onGenerate: (spec: ImageSpec, marker: string) => void;
}) {
  const segments = splitBodyByMarkers(body);
  const specByMarker = new Map(specs.map((s) => [s.marker, s]));

  return (
    <div className="text-[14px] leading-[1.85] font-sans">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <div key={i} className="whitespace-pre-wrap">
            {seg.text}
          </div>
        ) : (() => {
          const spec = specByMarker.get(seg.marker);
          // 見出し画像(アイキャッチ)はページ上部の見出し画像スロットに表示されるため、
          // 本文中には生成カードを出さず、位置を示す控えめな注記だけにする。
          if (spec && isHeaderSpec(spec)) {
            return (
              <div
                key={i}
                className="my-2 text-[11px] text-[color:var(--fg-muted)]"
              >
                🖼 {seg.marker}（見出し画像 — 記事上部に表示）
              </div>
            );
          }
          return (
            <ImageMarkerCard
              key={i}
              marker={seg.marker}
              label={seg.label}
              spec={spec}
              img={images[seg.marker]}
              onGenerate={onGenerate}
            />
          );
        })(),
      )}
    </div>
  );
}

function ImageMarkerCard({
  marker,
  label,
  spec,
  img,
  onGenerate,
}: {
  marker: string;
  label: string;
  spec?: ImageSpec;
  img?: MarkerImageState;
  onGenerate: (spec: ImageSpec, marker: string) => void;
}) {
  const loading = img?.state === "loading";
  const meta = spec
    ? [spec.placement, spec.type, spec.aspectRatio].filter(Boolean).join(" ・ ")
    : "";

  return (
    <div className="my-4 rounded-xl border border-dashed border-[color:var(--accent)]/50 bg-[color:var(--accent-soft)]/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-[11px] font-mono font-semibold text-[color:var(--accent-dark)]">
            🖼 {marker}
          </span>
          {(label || spec?.purpose) && (
            <span className="ml-2 text-[11px] text-[color:var(--fg-secondary)]">
              {label || spec?.purpose}
            </span>
          )}
          {meta && (
            <div className="text-[10px] text-[color:var(--fg-muted)] mt-0.5">{meta}</div>
          )}
        </div>
        {spec ? (
          <button
            type="button"
            onClick={() => onGenerate(spec, marker)}
            disabled={loading}
            className="btn-accent text-[11px] px-2.5 py-1 shrink-0 disabled:opacity-50"
          >
            {loading
              ? "生成中…"
              : img?.dataUrl
                ? "🔄 再生成"
                : "🎨 この画像を生成"}
          </button>
        ) : (
          <span className="text-[10px] text-[color:var(--fg-muted)] shrink-0">
            画像指示なし
          </span>
        )}
      </div>

      {img?.state === "error" && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1 mb-2">
          {img.error ?? "生成に失敗しました"}
        </div>
      )}

      {img?.dataUrl && (
        <div>
          <img
            src={img.dataUrl}
            alt={spec?.altText ?? label ?? marker}
            className="w-full rounded-lg border border-[var(--border-subtle)]"
          />
          <div className="mt-1.5 flex items-center gap-3">
            <a
              href={img.dataUrl}
              download={`${marker}.png`}
              className="text-[11px] text-[color:var(--accent-dark)] hover:underline"
            >
              画像DL
            </a>
            <span className="text-[10px] text-[color:var(--fg-muted)]">
              ※リロードで消えます。note の該当位置に手動で配置してください
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
