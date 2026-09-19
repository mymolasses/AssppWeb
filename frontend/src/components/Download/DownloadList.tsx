import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageContainer from '../Layout/PageContainer';
import Modal from '../common/Modal';
import ProgressBar from '../common/ProgressBar';
import Spinner from '../common/Spinner';
import LocalIpaGate, { isLocalIpaUnlocked } from '../Auth/LocalIpaGate';
import DownloadItem from './DownloadItem';
import {
  isDownloadPreviewEnabled,
  isPreviewDownloadTask,
  previewDownloadTasks,
} from './previewTasks';
import { useDownloads } from '../../hooks/useDownloads';
import { useAccounts } from '../../hooks/useAccounts';
import { useDownloadAction } from '../../hooks/useDownloadAction';
import { useToastStore } from '../../store/toast';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { lookupApp } from '../../api/search';
import { accountStoreCountry } from '../../utils/account';
import { getAccountContext } from '../../utils/toast';
import { isNewerVersion } from '../../utils/version';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../../constants/downloads';
import { storeIdToCountry } from '../../apple/config';
import type { DownloadTask } from '../../types';

type SourceFilter = 'all' | 'store' | 'local';
type SortMode = 'newest' | 'nameAsc' | 'nameDesc';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const headerActionClass =
  'inline-flex h-10 min-w-0 items-center justify-center rounded-lg px-3 text-center leading-tight transition-colors';

export default function DownloadList() {
  const { t } = useTranslation();
  const location = useLocation();
  const {
    tasks,
    loading,
    pauseDownload,
    resumeDownload,
    deleteDownload,
    hashToEmail,
    fetchTasks,
  } = useDownloads();
  const [accountFilter, setAccountFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [localIpaUnlocked, setLocalIpaUnlocked] = useState(
    isLocalIpaUnlocked,
  );
  const addToast = useToastStore((s) => s.addToast);
  const viewMode = useUiPreferencesStore((s) => s.downloadsViewMode);
  const setViewMode = useUiPreferencesStore((s) => s.setDownloadsViewMode);
  const { accounts } = useAccounts();
  const { startDownload } = useDownloadAction();
  const previewEnabled = isDownloadPreviewEnabled(location.search);
  const allDisplayTasks = previewEnabled ? previewDownloadTasks : tasks;
  const displayTasks =
    previewEnabled || localIpaUnlocked
      ? allDisplayTasks
      : allDisplayTasks.filter(
          (task) => task.accountHash !== LOCAL_UPLOAD_ACCOUNT_HASH,
        );

  const [checkingAll, setCheckingAll] = useState(false);
  const cancelCheckRef = useRef(false);
  const [checkProgress, setCheckProgress] = useState({
    current: 0,
    total: 0,
    appName: '',
  });

  useEffect(() => {
    return () => {
      cancelCheckRef.current = true;
    };
  }, []);

  const accountByEmail = new Map(
    accounts.map((account) => [account.email, account]),
  );
  const regions = Array.from(
    new Set(
      accounts
        .map((account) => accountStoreCountry(account))
        .filter((country): country is string => Boolean(country)),
    ),
  ).sort((a, b) =>
    t(`countries.${a}`).localeCompare(t(`countries.${b}`)),
  );

  const filteredTasks = displayTasks.filter((task) => {
    const isLocal = task.accountHash === LOCAL_UPLOAD_ACCOUNT_HASH;
    const accountEmail = hashToEmail[task.accountHash];
    const account = accountByEmail.get(accountEmail);
    const country = accountStoreCountry(account);

    if (sourceFilter === 'local' && !isLocal) return false;
    if (sourceFilter === 'store' && isLocal) return false;
    if (accountFilter !== 'all' && accountEmail !== accountFilter) return false;
    if (regionFilter !== 'all' && country !== regionFilter) return false;
    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortMode === 'nameAsc' || sortMode === 'nameDesc') {
      const nameA = a.displayName || a.software.name;
      const nameB = b.displayName || b.software.name;
      const result = nameA.localeCompare(nameB, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortMode === 'nameAsc' ? result : -result;
    }

    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  const hasActiveFilters =
    accountFilter !== 'all' ||
    regionFilter !== 'all' ||
    sourceFilter !== 'all';

  function taskRegionLabel(task: DownloadTask): string {
    if (task.accountHash === LOCAL_UPLOAD_ACCOUNT_HASH) {
      return t('downloads.upload.localSource');
    }
    if (isPreviewDownloadTask(task)) return t('countries.US');
    const email = hashToEmail[task.accountHash];
    const country = accountStoreCountry(accountByEmail.get(email));
    return country ? t(`countries.${country}`) : '—';
  }

  async function handleLocalIpaUnlock() {
    setLocalIpaUnlocked(true);
    await fetchTasks();
  }

  function handleDelete(id: string) {
    const task = displayTasks.find((item) => item.id === id);
    if (task && isPreviewDownloadTask(task)) {
      showPreviewNotice();
      return;
    }

    if (!confirm(t('downloads.deleteConfirm'))) return;

    if (task) {
      const accountEmail = hashToEmail[task.accountHash];
      const account = accounts.find((a) => a.email === accountEmail);
      const ctx = getAccountContext(account, t);

      addToast(
        t('toast.msg', {
          appName: task.displayName || task.software.name,
          ...ctx,
        }),
        'success',
        t('toast.title.deleteSuccess'),
      );
    }

    deleteDownload(id);
  }

  function showPreviewNotice() {
    addToast(
      t('downloads.preview.actionHint'),
      'info',
      t('downloads.preview.badge'),
    );
  }

  function handlePause(id: string) {
    if (previewEnabled) {
      showPreviewNotice();
      return;
    }
    pauseDownload(id);
  }

  function handleResume(id: string) {
    if (previewEnabled) {
      showPreviewNotice();
      return;
    }
    resumeDownload(id);
  }

  function handleCancelCheck() {
    cancelCheckRef.current = true;
    setCheckingAll(false);
  }

  async function handleCheckAllUpdates() {
    if (previewEnabled) {
      showPreviewNotice();
      return;
    }

    cancelCheckRef.current = false;
    setCheckingAll(true);
    addToast(t('downloads.checkUpdatesStarted'), 'info');
    let count = 0;
    const completedTasks = tasks.filter(
      (t) =>
        t.status === 'completed' && t.accountHash !== LOCAL_UPLOAD_ACCOUNT_HASH,
    );

    setCheckProgress({ current: 0, total: completedTasks.length, appName: '' });

    for (let i = 0; i < completedTasks.length; i++) {
      if (cancelCheckRef.current) break;

      const task = completedTasks[i];
      const accountEmail = hashToEmail[task.accountHash];
      const account = accounts.find((a) => a.email === accountEmail);

      setCheckProgress((prev) => ({
        ...prev,
        appName: task.displayName || task.software.name,
      }));

      if (!account) {
        setCheckProgress((prev) => ({ ...prev, current: i + 1 }));
        continue;
      }

      try {
        await delay(1500);
        if (cancelCheckRef.current) break;

        const country = storeIdToCountry(account.store) ?? 'US';
        const latestApp = await lookupApp(task.software.bundleID, country);

        if (
          latestApp &&
          isNewerVersion(latestApp.version, task.software.version)
        ) {
          await startDownload(account, latestApp);
          await deleteDownload(task.id);
          count++;
        }
      } catch {
        // Continue with next item
      }

      setCheckProgress((prev) => ({ ...prev, current: i + 1 }));
    }

    if (!cancelCheckRef.current) {
      await delay(500);
      if (!cancelCheckRef.current) {
        setCheckingAll(false);
        addToast(t('downloads.checkUpdatesCompleted', { count }), 'success');
      }
    }
  }

  return (
    <PageContainer>
      <div className="mb-6 flex min-w-0 flex-col gap-4 sm:mb-7 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-[2rem] font-semibold leading-[1.12] tracking-[-0.035em] text-gray-900 sm:text-[2.125rem] dark:text-white">
          {t('downloads.title')}
        </h1>
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:flex sm:shrink-0">
          <button
            onClick={handleCheckAllUpdates}
            disabled={checkingAll}
            className={`${headerActionClass} border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:disabled:border-gray-800 dark:disabled:bg-gray-900 dark:disabled:text-gray-600`}
          >
            <span className="text-sm font-semibold">
              {checkingAll
                ? t('downloads.checkingUpdates')
                : t('downloads.checkUpdates')}
            </span>
          </button>
          <Link
            to="/downloads/add"
            className={`${headerActionClass} border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950`}
          >
            <span className="text-sm font-semibold">{t('downloads.new')}</span>
          </Link>
          <Link
            to="/downloads/upload"
            className={`${headerActionClass} bg-blue-600 text-white hover:bg-blue-700`}
          >
            <span className="text-sm font-semibold">
              {t('downloads.upload.button')}
            </span>
          </Link>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto]">
          <FilterSelect
            label={t('downloads.filters.account')}
            value={accountFilter}
            onChange={setAccountFilter}
          >
            <option value="all">{t('downloads.filters.allAccounts')}</option>
            {accounts.map((account) => (
              <option key={account.email} value={account.email}>
                {account.email}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label={t('downloads.filters.region')}
            value={regionFilter}
            onChange={setRegionFilter}
          >
            <option value="all">{t('downloads.filters.allRegions')}</option>
            {regions.map((country) => (
              <option key={country} value={country}>
                {t(`countries.${country}`)}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label={t('downloads.filters.source')}
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value as SourceFilter)}
          >
            <option value="all">{t('downloads.filters.allSources')}</option>
            <option value="store">{t('downloads.filters.store')}</option>
            <option value="local">{t('downloads.filters.local')}</option>
          </FilterSelect>

          <FilterSelect
            label={t('downloads.sort.label')}
            value={sortMode}
            onChange={(value) => setSortMode(value as SortMode)}
          >
            <option value="newest">{t('downloads.sort.newest')}</option>
            <option value="nameAsc">{t('downloads.sort.nameAsc')}</option>
            <option value="nameDesc">{t('downloads.sort.nameDesc')}</option>
          </FilterSelect>

          <div className="col-span-2 flex min-w-0 items-end lg:col-span-1">
            <div
              className="grid h-10 w-full grid-cols-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800 lg:w-auto"
              role="group"
              aria-label={t('downloads.view.label')}
            >
              {(['compact', 'detailed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={`min-w-0 rounded-md px-3 text-xs font-semibold transition-colors ${
                    viewMode === mode
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {t(`downloads.view.${mode}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        role="note"
        aria-label={t('downloads.warning')}
        title={t('downloads.warning')}
        className="mb-5 min-w-0 max-w-full overflow-hidden rounded-2xl bg-amber-50 px-2.5 py-3 text-center leading-relaxed text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/50"
      >
        <span
          aria-hidden="true"
          className="block whitespace-nowrap text-[clamp(0.625rem,3.1vw,0.75rem)] xl:hidden"
        >
          {t('downloads.warningShort')}
        </span>
        <span
          aria-hidden="true"
          className="hidden whitespace-nowrap text-xs xl:block"
        >
          {t('downloads.warning')}
        </span>
      </div>

      {previewEnabled && (
        <div className="mb-5 flex min-w-0 items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-blue-600 px-2 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            {t('downloads.preview.badge')}
          </span>
          <p className="min-w-0 leading-5">
            {t('downloads.preview.description')}
          </p>
        </div>
      )}

      {!previewEnabled && sourceFilter === 'local' && !localIpaUnlocked ? (
        <LocalIpaGate onUnlock={handleLocalIpaUnlock}>
          <div className="py-12 text-center text-gray-500 dark:text-gray-400">
            {t('downloads.loading')}
          </div>
        </LocalIpaGate>
      ) : loading && displayTasks.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12">
          {t('downloads.loading')}
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="my-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center dark:border-gray-800 dark:bg-gray-900/30">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white dark:bg-gray-900">
            <svg
              className="h-8 w-8 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 text-center">
            {hasActiveFilters
              ? t('downloads.emptyFiltered')
              : t('downloads.emptyAll')}
          </h3>
          <p
            className="mb-6 max-w-full overflow-hidden text-center text-gray-500 dark:text-gray-400"
            aria-label={
              hasActiveFilters
                ? t('downloads.emptyFilteredDesc')
                : t('downloads.emptyAllDesc')
            }
            title={
              hasActiveFilters
                ? t('downloads.emptyFilteredDesc')
                : t('downloads.emptyAllDesc')
            }
          >
            {!hasActiveFilters ? (
              <>
                <span
                  aria-hidden="true"
                  className="block whitespace-nowrap text-[clamp(0.625rem,3vw,0.875rem)] xl:hidden"
                >
                  {t('downloads.emptyAllDescShort')}
                </span>
                <span
                  aria-hidden="true"
                  className="hidden whitespace-nowrap text-sm xl:block"
                >
                  {t('downloads.emptyAllDesc')}
                </span>
              </>
            ) : (
              <span className="block whitespace-nowrap text-[clamp(0.625rem,3vw,0.875rem)]">
                {t('downloads.emptyFilteredDesc')}
              </span>
            )}
          </p>
          {!hasActiveFilters && (
            <Link
              to="/search"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              {t('downloads.searchApps')}
            </Link>
          )}
        </div>
      ) : (
        <div
          className={
            viewMode === 'compact'
              ? 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6'
              : 'space-y-3'
          }
        >
          {sortedTasks.map((task) => (
            <DownloadItem
              key={task.id}
              task={task}
              preview={previewEnabled}
              compact={viewMode === 'compact'}
              regionLabel={taskRegionLabel(task)}
              onPause={handlePause}
              onResume={handleResume}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <Modal
        open={checkingAll && checkProgress.total > 0}
        onClose={handleCancelCheck}
        title={t('downloads.checkingUpdates')}
      >
        <div className="space-y-4">
          <div className="flex justify-center text-blue-600 dark:text-blue-400">
            <Spinner />
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {checkProgress.appName
                ? `${t('downloads.checkingApp')}${checkProgress.appName}`
                : '...'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
              {checkProgress.current} / {checkProgress.total}
            </p>
          </div>
          <ProgressBar
            label={t('downloads.checkingUpdates')}
            progress={
              checkProgress.total > 0
                ? (checkProgress.current / checkProgress.total) * 100
                : 0
            }
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            {t('downloads.checkUpdatesDesc')}
          </p>
          <div className="flex justify-center">
            <button
              onClick={handleCancelCheck}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('settings.data.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 truncate rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-sm text-gray-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        {children}
      </select>
    </label>
  );
}
