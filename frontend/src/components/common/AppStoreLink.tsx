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
    <div className="mt-4 grid w-full min-w-0 grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] gap-2 sm:max-w-lg">
      <a
        href={`https://itunes.apple.com/WebObjects/MZStore.woa/wa/resetAndRedirect?${parameters}`}
        title={t('search.product.openInAppStore', { region })}
        className="inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-full bg-blue-50 px-1.5 text-center text-[clamp(0.625rem,3vw,0.875rem)] font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-400 dark:hover:bg-blue-950 sm:gap-2 sm:px-4 sm:text-sm"
      >
        <span className="truncate">{t('search.product.openInAppStore', { region })}</span>
        <span aria-hidden="true" className="hidden shrink-0 sm:inline">↗</span>
      </a>
      <a
        href={`https://apps.apple.com/${cc}/app/id${appId}`}
        target="_blank"
        rel="noopener noreferrer"
        title={t('search.product.appStoreWebPage')}
        className="inline-flex h-10 min-w-0 items-center justify-center rounded-full bg-purple-50 px-1.5 text-center text-[clamp(0.625rem,3vw,0.875rem)] font-semibold text-purple-700 transition-colors hover:bg-purple-100 dark:bg-purple-950/60 dark:text-purple-300 dark:hover:bg-purple-950 sm:px-4 sm:text-sm"
      >
        <span className="truncate">{t('search.product.appStoreWebPage')}</span>
      </a>
    </div>
  );
}
