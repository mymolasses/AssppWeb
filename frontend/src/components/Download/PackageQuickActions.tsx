import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import ProgressBar from '../common/ProgressBar';
import { isPreviewDownloadTask } from './previewTasks';
import { useToastStore } from '../../store/toast';
import { getInstallInfo } from '../../api/install';
import { downloadPackage, type PackageDownloadProgress } from '../../api/packageDownload';
import { formatBytes } from '../../utils/format';
import type { DownloadTask } from '../../types';

interface PackageQuickActionsProps {
  task: DownloadTask;
  size?: 'compact' | 'default';
}

const iconClassName = 'h-4 w-4 shrink-0';

export default function PackageQuickActions({
  task,
  size = 'default',
}: PackageQuickActionsProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((state) => state.addToast);
  const [downloadProgress, setDownloadProgress] = useState<PackageDownloadProgress | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [installRequested, setInstallRequested] = useState(false);
  useEffect(() => () => downloadController.current?.abort(), []);

  if (task.status !== 'completed' || !task.hasFile) return null;

  const installInfo = getInstallInfo(task.id);
  const isPreview = isPreviewDownloadTask(task);
  const buttonSize =
    size === 'compact' ? 'min-h-10 px-2 text-xs' : 'min-h-11 px-3 text-sm';
  const secondaryButton = `${buttonSize} inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800`;

  function showPreviewNotice() {
    addToast(
      t('downloads.preview.actionHint'),
      'info',
      t('downloads.preview.badge'),
    );
  }

  function handleInstall(event: MouseEvent<HTMLAnchorElement>) {
    if (isPreview) {
      event.preventDefault();
      showPreviewNotice();
      return;
    }

    setInstallRequested(true);

    addToast(
      task.displayName || task.software.name,
      'info',
      t('toast.title.installStarted'),
    );
  }

  async function handleShare() {
    if (isPreview) {
      showPreviewNotice();
      return;
    }

    try {
      await copyText(installInfo.installUrl);
      addToast(
        t('downloads.package.copied'),
        'success',
        t('toast.title.shareAcquired'),
      );

      if (navigator.share) {
        await navigator.share({
          title: task.displayName || task.software.name,
          text: installInfo.installUrl,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      addToast(
        t('downloads.package.shareFailed'),
        'error',
        t('downloads.package.share'),
      );
    }
  }

  async function handleDownload() {
    if (isPreview) {
      showPreviewNotice();
      return;
    }
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloadProgress({ loaded: 0 });

    addToast(
      task.displayName || task.software.name,
      'info',
      t('toast.title.downloadIpaStarted'),
    );

    try {
      const blob = await downloadPackage(task.id, task.accountHash, setDownloadProgress, controller.signal);
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = packageFileName(task);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Safari may consume the object URL after the click handler has returned.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      if (controller.signal.aborted) return;
      addToast(
        t('downloads.package.downloadFailed'),
        'error',
        t('downloads.package.downloadIpa'),
      );
    } finally {
      downloadController.current = null;
      setDownloadProgress(null);
    }
  }

  return (
    <div
      className="grid min-w-0 grid-cols-3 gap-2"
      aria-label={t('downloads.package.quickActions')}
      data-testid="package-quick-actions"
    >
      <a
        href={installInfo.installUrl}
        onClick={handleInstall}
        className={`${buttonSize} inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900`}
        aria-label={t('downloads.package.install')}
      >
        <InstallIcon />
        <span className="truncate">{t('downloads.package.installShort')}</span>
      </a>

      <div className="group relative min-w-0">
        <button
          type="button"
          onClick={handleShare}
          aria-describedby={isPreview ? undefined : `install-qr-${task.id}`}
          className={`${secondaryButton} w-full`}
          aria-label={t('downloads.package.share')}
        >
          <ShareIcon />
          <span className="truncate">{t('downloads.package.share')}</span>
        </button>
        {!isPreview && (
          <div
            id={`install-qr-${task.id}`}
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 opacity-0 transition-opacity duration-200 md:invisible md:block md:group-hover:visible md:group-hover:opacity-100 md:group-focus-within:visible md:group-focus-within:opacity-100"
          >
            <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              <QRCodeSVG
                value={installInfo.installUrl}
                size={128}
                className="mb-1 rounded bg-white p-1"
              />
              <span className="mt-1 whitespace-nowrap text-xs">
                {t('downloads.package.scan')}
              </span>
              <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleDownload}
        disabled={downloadProgress !== null}
        className={secondaryButton}
        aria-label={t('downloads.package.downloadIpa')}
      >
        <DownloadIcon />
        <span className="truncate">{t('downloads.package.downloadShort')}</span>
      </button>
      {downloadProgress && (
        <div className="col-span-3 min-w-0 space-y-2" role="status">
          {downloadProgress.total ? <ProgressBar
            progress={downloadProgress.loaded / downloadProgress.total * 100}
            label={t('downloads.package.downloadIpa')}
          /> : <span className="block text-xs text-gray-500 dark:text-gray-400">{t('downloads.package.receiving')}</span>}
          <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{formatBytes(String(downloadProgress.loaded))}{downloadProgress.total ? ` / ${formatBytes(String(downloadProgress.total))} · ${Math.min(100, Math.floor(downloadProgress.loaded / downloadProgress.total * 100))}%` : ''}</span>
            <button type="button" onClick={() => downloadController.current?.abort()} className="text-blue-600 dark:text-blue-400">{t('downloads.package.cancelDownload')}</button>
          </div>
        </div>
      )}
      {installRequested && <p role="status" className="col-span-3 text-xs text-gray-500 dark:text-gray-400">{t('downloads.package.installHint')}</p>}
    </div>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function packageFileName(task: DownloadTask): string {
  const unsafeName = `${task.displayName || task.software.name}_${
    task.software.version
  }`;
  const safeName = unsafeName.replace(/[\\/:*?"<>|]/g, '-');
  return `${safeName}.ipa`;
}

function InstallIcon() {
  return (
    <svg
      aria-hidden="true"
      className={iconClassName}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      className={iconClassName}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 12v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7M12 3v12m0-12 4 4m-4-4L8 7"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className={iconClassName}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"
      />
    </svg>
  );
}
