import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../api/client";

const SESSION_KEY = "local-ipa-token";

export function isLocalIpaUnlocked(): boolean {
  return Boolean(sessionStorage.getItem(SESSION_KEY));
}

export default function LocalIpaGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(isLocalIpaUnlocked);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      const response = await fetch("/api/local-ipa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { ok: boolean };
      if (result.ok) {
        const token = (result as { token?: string }).token;
        if (token) sessionStorage.setItem(SESSION_KEY, token);
        setUnlocked(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {t("localIpa.title")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("localIpa.description")}
        </p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("localIpa.placeholder")}
          autoFocus
          className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{t("localIpa.error")}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? t("localIpa.verifying") : t("localIpa.submit")}
        </button>
      </form>
    </div>
  );
}
