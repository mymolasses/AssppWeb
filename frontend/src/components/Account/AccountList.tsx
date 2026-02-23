import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAccountsStore } from "../../store/accounts";
import { storeIdToCountry } from "../../apple/config";
import PageContainer from "../Layout/PageContainer";

export default function AccountList() {
  const { t } = useTranslation();
  const { accounts, loading, loadAccounts } = useAccountsStore();

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  return (
    <PageContainer
      title={t("accounts.title")}
      action={
        <Link
          to="/accounts/add"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t("accounts.add")}
        </Link>
      }
    >
      {loading ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12">
          {t("accounts.loading")}
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {t("accounts.empty")}
          </p>
          <Link
            to="/accounts/add"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
          >
            {t("accounts.addFirst")}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const countryCode =
              storeIdToCountry(account.store) || account.store;

            return (
              <NavLink
                key={account.email}
                to={`/accounts/${encodeURIComponent(account.email)}`}
                className={({ isActive }) =>
                  `block bg-white dark:bg-gray-900 rounded-lg border p-4 transition-colors ${
                    isActive
                      ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30"
                      : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
                  }`
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {account.firstName} {account.lastName}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {account.email}
                    </p>
                  </div>
                  <div className="text-sm text-gray-400 dark:text-gray-500">
                    {/* Translate country code to localized name */}
                    {t(`countries.${countryCode}`, countryCode)}
                  </div>
                </div>
              </NavLink>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
