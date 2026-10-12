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
  if (
    !Number.isSafeInteger(appId) || appId <= 0 ||
    !countryCode || !countryCodeMap[countryCode]
  ) {
    return null;
  }

  const region = t(`countries.${countryCode}`, countryCode);
  const cc = countryCode.toLowerCase();
  // Keep the app ID and country inside the nested URL. An unescaped '&' would
  // turn them into resetAndRedirect parameters and lose the target app.
  const parameters = new URLSearchParams({
    dsf: countryCodeMap[countryCode],
    mt: '8',
    cc,
    url: `/WebObjects/MZStore.woa/wa/viewSoftware?mt=8&id=${appId}&cc=${cc}`,
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a
        href={`https://itunes.apple.com/WebObjects/MZStore.woa/wa/resetAndRedirect?${parameters}`}
        className="inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-center text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:hover:bg-blue-950 sm:text-sm"
      >
        {t('search.product.openInAppStore', { region })}
        <span aria-hidden="true">↗</span>
      </a>
      <a
        href={`https://apps.apple.com/${cc}/app/id${appId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 max-w-full items-center justify-center rounded-full bg-purple-50 px-4 py-2 text-center text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 dark:bg-purple-950/60 dark:text-purple-300 dark:hover:bg-purple-950 sm:text-sm"
      >
        {t('search.product.appStoreWebPage')}
      </a>
    </div>
  );
}
