import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import AppIcon from "../common/AppIcon";
import Alert from "../common/Alert";
import CountrySelect from "../common/CountrySelect";
import { useSearch } from "../../hooks/useSearch";
import { useAccounts } from "../../hooks/useAccounts";
import { useSettingsStore } from "../../store/settings";
import { countryCodeMap, storeIdToCountry } from "../../apple/config";
import { firstAccountCountry } from "../../utils/account";

export default function SearchPage() {
  const { t } = useTranslation();
  const { defaultCountry, defaultEntity } = useSettingsStore();
  const { accounts } = useAccounts();
  const initialCountry = firstAccountCountry(accounts) ?? defaultCountry;
  const [term, setTerm] = useState("");
  const [country, setCountry] = useState(initialCountry);
  const [entity, setEntity] = useState<string>(defaultEntity);
  const { results, loading, error, search } = useSearch();

  const availableCountryCodes = Array.from(
    new Set(
      accounts
        .map((a) => storeIdToCountry(a.store))
        .filter(Boolean) as string[],
    ),
  ).sort((a, b) =>
    t(`countries.${a}`, a).localeCompare(t(`countries.${b}`, b)),
  );

  const allCountryCodes = Object.keys(countryCodeMap).sort((a, b) =>
    t(`countries.${a}`, a).localeCompare(t(`countries.${b}`, b)),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    search(term.trim(), country, entity);
  }

  return (
    <PageContainer title={t("search.title")}>
      <form onSubmit={handleSubmit} className="space-y-4 mb-6 max-w-lg">
        <div className="flex gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !term.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {loading ? t("search.searching") : t("search.button")}
          </button>
        </div>
        <div className="flex w-full gap-3 overflow-hidden">
          <CountrySelect
            value={country}
            onChange={setCountry}
            availableCountryCodes={availableCountryCodes}
            allCountryCodes={allCountryCodes}
            className="w-1/2 truncate bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700"
          />
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            className="w-1/2 truncate rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          >
            <option value="iPhone">iPhone</option>
            <option value="iPad">iPad</option>
          </select>
        </div>
      </form>

      {error && (
        <Alert type="error" className="mb-4 max-w-lg">
          {error}
        </Alert>
      )}

      {/* 搜索页面：空状态占位，同样限制宽度 max-w-lg 并与表单对齐 */}
      {results.length === 0 && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-gray-50 dark:bg-gray-900/30 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl transition-colors max-w-lg">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-full shadow-sm mb-4 border border-gray-100 dark:border-gray-700">
            <svg
              className="w-12 h-12 text-blue-500 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 text-center">
            {t("search.empty")}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-sm">
            输入应用名称或 Bundle ID，快速在 App Store 中查找并获取应用详情与许可证。
          </p>
        </div>
      )}

      <div className="space-y-2">
        {results.map((app) => (
          <Link
            key={app.id}
            to={`/search/${app.id}`}
            state={{ app, country }}
            className="block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center gap-4">
              <AppIcon url={app.artworkUrl} name={app.name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {app.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {app.artistName}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                  <span>{app.formattedPrice ?? t("search.free")}</span>
                  <span>{app.primaryGenreName}</span>
                  <span>
                    {app.averageUserRating.toFixed(1)} ({app.userRatingCount})
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
