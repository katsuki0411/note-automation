"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form
        action={formAction}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border-card)] p-8 space-y-5"
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--fg-muted)] mb-2">
            Sign in
          </div>
          <h1 className="text-xl font-semibold tracking-tight">note自動化システム</h1>
          <p className="text-[12px] text-[color:var(--fg-secondary)] mt-1">
            ログインしてください
          </p>
        </div>

        <input type="hidden" name="next" value={next} />

        <label className="block">
          <span className="block text-[12px] font-medium text-[color:var(--fg-secondary)] mb-1">
            メールアドレス
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            disabled={pending}
            className="w-full text-[14px] px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white"
          />
        </label>

        <label className="block">
          <span className="block text-[12px] font-medium text-[color:var(--fg-secondary)] mb-1">
            パスワード
          </span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            disabled={pending}
            className="w-full text-[14px] px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white"
          />
        </label>

        {state?.error && (
          <div className="text-[12px] px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-100">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn-primary w-full disabled:opacity-50"
        >
          {pending ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
