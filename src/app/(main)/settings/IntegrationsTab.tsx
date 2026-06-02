"use client";

import { useEffect, useState } from "react";

// =========================================================
// API 連携設定タブ
// =========================================================
// - プロジェクト単位: Amazon アソシエイト + PA-API / A8.net
// - ユーザー単位: Brave Search / Gemini / Claude
// 既存env は触らず DB に上書きとして保存する。利用側 (Amazon/A8) は
// 記事生成時に DB を見るので即反映。Brave/Gemini/Claude はシングルトン SDK が
// 起動時 env で固定されているため、UI 変更後は dev server 再起動が必要 (UI で注記)。
// =========================================================

type IntegrationRow = {
  config: Record<string, string>;
  enabled: boolean;
  updated_at: string;
};

type IntegrationsResponse = {
  project: {
    amazon_associate: IntegrationRow | null;
    a8_net: IntegrationRow | null;
  };
  user: {
    brave_search: IntegrationRow | null;
    gemini: IntegrationRow | null;
    claude: IntegrationRow | null;
  };
};

type FieldDef = {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
  hint?: string;
};

type IntegrationDef = {
  scope: "project" | "user";
  kind: string;
  title: string;
  description: string;
  badge?: string;          // 「プロジェクト単位」「ユーザー単位」表示用
  envFallbackNote?: string; // env から読まれる旨の注釈
  restartRequired?: boolean; // 保存後に dev server 再起動が必要か
  fields: FieldDef[];
};

const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    scope: "project",
    kind: "amazon_associate",
    title: "Amazon アソシエイト + PA-API",
    description:
      "Amazon 商品リンクへのアフィタグ自動付与 / PA-API での商品情報取得に使用。プロジェクトごとに別アカウント運用可能。",
    badge: "プロジェクト単位",
    fields: [
      {
        key: "tracking_id",
        label: "トラッキングID",
        type: "text",
        placeholder: "例: yourname-22",
        hint: "アソシエイト管理画面 → 「トラッキング ID の管理」 で確認",
      },
      {
        key: "pa_api_access_key",
        label: "PA-API Access Key",
        type: "text",
        placeholder: "AKIA... (本承認後に発行)",
        hint: "本承認後 https://affiliate.amazon.co.jp/assoc_credentials/home で発行",
      },
      {
        key: "pa_api_secret_key",
        label: "PA-API Secret Key",
        type: "password",
        placeholder: "1回しか表示されないので安全に控える",
      },
      {
        key: "marketplace",
        label: "Marketplace (任意)",
        type: "text",
        placeholder: "www.amazon.co.jp",
        hint: "未入力で日本 (www.amazon.co.jp) がデフォルト",
      },
    ],
  },
  {
    scope: "project",
    kind: "a8_net",
    title: "A8.net",
    description:
      "A8.net アフィリエイトリンクへのメディアID/SID 自動付与に使用。プロジェクトごとに別アカウント運用可能。",
    badge: "プロジェクト単位",
    fields: [
      {
        key: "media_id",
        label: "メディアID",
        type: "text",
        placeholder: "例: m12345678",
      },
      {
        key: "default_sid",
        label: "デフォルト SID (任意)",
        type: "text",
        placeholder: "リンクの sid パラメータの初期値",
      },
    ],
  },
  {
    scope: "user",
    kind: "brave_search",
    title: "Brave Search API",
    description:
      "商品スカウト / SEO順位スキャンで使用する検索 API。空欄なら環境変数 BRAVE_SEARCH_API_KEY を使用。",
    badge: "ユーザー単位",
    envFallbackNote: "未設定なら .env.local の BRAVE_SEARCH_API_KEY を使用",
    restartRequired: true,
    fields: [
      {
        key: "api_key",
        label: "API キー",
        type: "password",
        placeholder: "BSA... で始まるキー",
        hint: "https://api-dashboard.search.brave.com/ で発行",
      },
    ],
  },
  {
    scope: "user",
    kind: "gemini",
    title: "Gemini API",
    description:
      "AI ネタ収集 / キーワード展開 / 五軸評価で使用。空欄なら環境変数 GEMINI_API_KEY を使用。",
    badge: "ユーザー単位",
    envFallbackNote: "未設定なら .env.local の GEMINI_API_KEY を使用",
    restartRequired: true,
    fields: [
      {
        key: "api_key",
        label: "API キー",
        type: "password",
        placeholder: "AIzaSy... で始まるキー",
        hint: "https://aistudio.google.com/app/apikey で発行",
      },
    ],
  },
  {
    scope: "user",
    kind: "claude",
    title: "Claude API",
    description:
      "記事生成 (Sonnet 4.6) で使用。空欄なら環境変数 ANTHROPIC_API_KEY を使用。",
    badge: "ユーザー単位",
    envFallbackNote: "未設定なら .env.local の ANTHROPIC_API_KEY を使用",
    restartRequired: true,
    fields: [
      {
        key: "api_key",
        label: "API キー",
        type: "password",
        placeholder: "sk-ant-api03-... で始まるキー",
        hint: "https://console.anthropic.com/ で発行",
      },
    ],
  },
];

export default function IntegrationsTab() {
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [updatedMap, setUpdatedMap] = useState<Record<string, string | null>>({});
  const [savingKind, setSavingKind] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) return;
      const data = (await res.json()) as IntegrationsResponse;
      const v: Record<string, Record<string, string>> = {};
      const en: Record<string, boolean> = {};
      const up: Record<string, string | null> = {};
      for (const def of INTEGRATION_DEFS) {
        const row =
          def.scope === "project"
            ? data.project[def.kind as keyof typeof data.project]
            : data.user[def.kind as keyof typeof data.user];
        v[def.kind] = (row?.config as Record<string, string>) ?? {};
        en[def.kind] = row?.enabled ?? true;
        up[def.kind] = row?.updated_at ?? null;
      }
      setValues(v);
      setEnabledMap(en);
      setUpdatedMap(up);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setField(kind: string, key: string, value: string) {
    setValues((s) => ({
      ...s,
      [kind]: { ...(s[kind] ?? {}), [key]: value },
    }));
  }

  async function save(def: IntegrationDef) {
    setSavingKind(def.kind);
    setSavedFlash(null);
    try {
      const cleaned: Record<string, string> = {};
      for (const f of def.fields) {
        const v = (values[def.kind]?.[f.key] ?? "").trim();
        if (v) cleaned[f.key] = v;
      }
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: def.scope,
          kind: def.kind,
          config: cleaned,
          enabled: enabledMap[def.kind] ?? true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "保存失敗");
      }
      // 楽観的 UI 更新: サーバー値を再 fetch せず、ローカル state を即時反映 (DBはSydneyで往復遅いため)
      setSavedFlash(def.kind);
      setUpdatedMap((s) => ({ ...s, [def.kind]: new Date().toISOString() }));
      setValues((s) => ({ ...s, [def.kind]: cleaned }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失敗");
    } finally {
      setSavingKind(null);
    }
  }

  // loading 中もフォームを先に描画し、値だけ後から埋まる形にする
  // (DB がシドニーで初回 fetch に 200〜400ms かかるため、白画面回避)
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="section-title mb-1">API連携</h2>
        <p className="text-[13px] text-[color:var(--fg-secondary)] leading-relaxed">
          外部 API キーやアフィリエイトIDを保存します。
          <span className="text-[color:var(--accent-dark)] font-semibold mx-1">プロジェクト単位</span>
          は現プロジェクトに紐づき、
          <span className="text-[color:var(--accent-dark)] font-semibold mx-1">ユーザー単位</span>
          はログインユーザー全体で共有されます。
        </p>
        {loading && (
          <p className="text-[11px] text-[color:var(--fg-muted)] mt-1">⏳ 設定読込中…</p>
        )}
      </div>

      <ul className="space-y-3">
        {INTEGRATION_DEFS.map((def) => {
          const isSaving = savingKind === def.kind;
          const justSaved = savedFlash === def.kind;
          const cfg = values[def.kind] ?? {};
          const hasAnyValue = def.fields.some((f) => (cfg[f.key] ?? "").trim());
          const updated = updatedMap[def.kind];
          return (
            <li
              key={def.kind}
              className="p-4 rounded-lg border border-[var(--border-subtle)] space-y-3 bg-white"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[14px] font-semibold text-[color:var(--fg-primary)]">
                      {def.title}
                    </h3>
                    {def.badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          def.scope === "project"
                            ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)]"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {def.badge}
                      </span>
                    )}
                    {hasAnyValue && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                        ✓ 設定済
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[color:var(--fg-secondary)] leading-snug mt-1">
                    {def.description}
                  </p>
                  {def.envFallbackNote && (
                    <p className="text-[10px] text-[color:var(--fg-muted)] mt-0.5">
                      ℹ {def.envFallbackNote}
                    </p>
                  )}
                  {def.restartRequired && (
                    <p className="text-[10px] text-orange-700 mt-0.5">
                      ⚠ このAPIはシングルトンSDK経由のため、保存後に dev server 再起動が必要
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                {def.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[11px] text-[color:var(--fg-secondary)]">
                      {f.label}
                    </span>
                    <input
                      type={f.type === "password" ? "password" : "text"}
                      value={cfg[f.key] ?? ""}
                      onChange={(e) => setField(def.kind, f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="input-base mt-1 font-mono"
                      // ブラウザのパスワードマネージャーが自動入力するのを防ぐ
                      // (Amazon アクセスキー等の API キー入力欄が誤認される)
                      name={`integration-${def.kind}-${f.key}`}
                      autoComplete={f.type === "password" ? "new-password" : "off"}
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-form-type="other"
                    />
                    {f.hint && (
                      <span className="block text-[10px] text-[color:var(--fg-muted)] mt-1">
                        {f.hint}
                      </span>
                    )}
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] text-[color:var(--fg-muted)]">
                  {updated && (
                    <span>
                      最終更新:{" "}
                      {new Date(updated).toLocaleString("ja-JP", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                  {justSaved && (
                    <span className="text-[color:var(--accent-dark)] font-semibold">
                      ✓ 保存しました
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => save(def)}
                  disabled={isSaving}
                  className="btn-accent disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {isSaving ? "保存中…" : "保存"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
