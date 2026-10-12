import { useTranslation } from 'react-i18next';
import { countryCodeMap } from '../../apple/config';

export default function AppStoreLink({
  appId,
  country,
}: {
  appId: number;
  country?: string;
}) {
  const { t } = useTranslation();
  const countryCode = country?.trim().toUpperCase();
  if (!Number.isSafeInteger(appId) || appId <= 0 || !countryCode || !countryCodeMap[countryCode]) {
    return null;
  }

  const region = t(`countries.${countryCode}`, countryCode);
  return (
    <a
      href={`https://apps.apple.com/${countryCode.toLowerCase()}/app/id${appId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-center text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:hover:bg-blue-950 sm:text-sm"
    >
      {t('search.product.openInAppStore', { region })}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
