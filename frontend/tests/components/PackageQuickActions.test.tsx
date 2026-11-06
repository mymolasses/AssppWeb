import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PackageQuickActions from '../../src/components/Download/PackageQuickActions';
import { previewDownloadTasks } from '../../src/components/Download/previewTasks';
import { useToastStore } from '../../src/store/toast';
import type { DownloadTask } from '../../src/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const downloads = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../../src/api/packageDownload', () => ({ downloadPackage: downloads.download }));

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);
const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL',
);
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL',
);

function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'real-download-task',
    software: {
      id: 123,
      bundleID: 'com.example.utility',
      name: 'Utility/App',
      version: '3.4.5',
      artistName: 'Example Developer',
      sellerName: 'Example Developer LLC',
      description: 'A test application.',
      averageUserRating: 4.8,
      userRatingCount: 42,
      artworkUrl: '',
      screenshotUrls: [],
      minimumOsVersion: '16.0',
      fileSizeBytes: '5242880',
      releaseDate: '2026-08-01T00:00:00Z',
      primaryGenreName: 'Utilities',
    },
    accountHash: 'account-hash-123',
    status: 'completed',
    progress: 100,
    speed: '',
    hasFile: true,
    createdAt: '2026-08-02T00:00:00Z',
    ...overrides,
  };
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor?: PropertyDescriptor,
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

describe('PackageQuickActions', () => {
  beforeEach(() => {
    sessionStorage.clear();
    downloads.download.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreProperty(navigator, 'clipboard', originalClipboard);
    restoreProperty(navigator, 'share', originalShare);
    restoreProperty(URL, 'createObjectURL', originalCreateObjectURL);
    restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    useToastStore.setState({ toasts: [] });
  });

  it('shows install, share, and download for a completed package with a file', () => {
    render(<PackageQuickActions task={createTask()} />);

    expect(screen.getByTestId('package-quick-actions')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'downloads.package.install' }),
    ).toHaveAttribute('href', expect.stringMatching(/^itms-services:\/\//));
    expect(
      screen.getByRole('button', { name: 'downloads.package.share' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'downloads.package.downloadIpa' }),
    ).toBeInTheDocument();
  });

  it('does not show quick actions when a completed task has no file', () => {
    render(<PackageQuickActions task={createTask({ hasFile: false })} />);

    expect(
      screen.queryByTestId('package-quick-actions'),
    ).not.toBeInTheDocument();
  });

  it.each<DownloadTask['status']>([
    'pending',
    'downloading',
    'paused',
    'injecting',
    'failed',
  ])('does not show quick actions for a %s task', (status) => {
    render(<PackageQuickActions task={createTask({ status })} />);

    expect(
      screen.queryByTestId('package-quick-actions'),
    ).not.toBeInTheDocument();
  });

  it('keeps all preview actions local and shows a notice for each click', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: nativeShare,
    });

    render(<PackageQuickActions task={previewDownloadTasks[0]} />);

    await user.click(
      screen.getByRole('link', { name: 'downloads.package.install' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'downloads.package.share' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'downloads.package.downloadIpa' }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(nativeShare).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'downloads.preview.actionHint',
          title: 'downloads.preview.badge',
          type: 'info',
        }),
      ]),
    );
  });

  it('shows real download progress before saving and retains the IPA filename', async () => {
    const user = userEvent.setup();
    const ipaBlob = new Blob(['ipa contents'], { type: 'application/octet-stream' });
    let complete!: (blob: Blob) => void;
    downloads.download.mockImplementation(() => new Promise<Blob>(resolve => { complete = resolve; }));
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-ipa');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    let clickedAnchor: HTMLAnchorElement | undefined;
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { clickedAnchor = this; });
    render(<PackageQuickActions task={createTask()} />);
    const button = screen.getByRole('button', { name: 'downloads.package.downloadIpa' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(downloads.download).toHaveBeenCalledWith('real-download-task', 'account-hash-123', expect.any(Function), expect.any(AbortSignal));
    act(() => downloads.download.mock.calls[0][2]({ loaded: 25, total: 100 }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    expect(anchorClick).not.toHaveBeenCalled();
    await act(async () => complete(ipaBlob));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledWith(ipaBlob);
    expect(clickedAnchor?.download).toBe('Utility-App_3.4.5.ipa');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it('cancels reception without showing a download failure', async () => {
    const user = userEvent.setup();
    downloads.download.mockImplementation((_id, _hash, _progress, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    render(<PackageQuickActions task={createTask()} />);
    await user.click(screen.getByRole('button', { name: 'downloads.package.downloadIpa' }));
    await user.click(screen.getByRole('button', { name: 'downloads.package.cancelDownload' }));
    expect(downloads.download.mock.calls[0][3].aborted).toBe(true);
    expect(useToastStore.getState().toasts.some(toast => toast.type === 'error')).toBe(false);
  });
});
