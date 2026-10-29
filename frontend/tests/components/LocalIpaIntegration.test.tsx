import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadItem from '../../src/components/Download/DownloadItem';
import PackageDetail from '../../src/components/Download/PackageDetail';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../../src/constants/downloads';
import type { Account, DownloadTask } from '../../src/types';

const mocks = vi.hoisted(() => ({
  tasks: [] as DownloadTask[],
  accounts: [] as Account[],
  hashToEmail: {} as Record<string, string>,
  fetchTasks: vi.fn(),
  analyzeSigning: vi.fn(),
  updateDisplayName: vi.fn(),
  updateVisibility: vi.fn(),
  updateFavorite: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../src/hooks/useDownloads', () => ({
  useDownloads: () => ({
    tasks: mocks.tasks,
    hashToEmail: mocks.hashToEmail,
    fetchTasks: mocks.fetchTasks,
  }),
}));
vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({ accounts: mocks.accounts }),
}));
vi.mock('../../src/hooks/useDownloadAction', () => ({
  useDownloadAction: () => ({ startDownload: vi.fn() }),
}));
vi.mock('../../src/api/downloads', () => ({
  analyzeDownloadSigning: mocks.analyzeSigning,
  updateDownloadDisplayName: mocks.updateDisplayName,
  updateDownloadVisibility: mocks.updateVisibility,
  updateDownloadFavorite: mocks.updateFavorite,
}));
vi.mock('../../src/apple/versionFinder', () => ({
  listVersions: vi.fn(),
}));

const task: DownloadTask = {
  id: 'local-test',
  accountHash: LOCAL_UPLOAD_ACCOUNT_HASH,
  status: 'completed',
  progress: 100,
  speed: '',
  createdAt: '2026-09-05T00:00:00Z',
  hasFile: true,
  displayName: 'My Test Build',
  originalFileName: '九号出行_旧版_1.0.ipa',
  software: {
    id: 0,
    bundleID: 'com.example.local',
    name: 'Local App',
    version: '1.0',
    artistName: 'Example',
    sellerName: 'Example',
    description: '',
    averageUserRating: 0,
    userRatingCount: 0,
    artworkUrl: '',
    screenshotUrls: [],
    minimumOsVersion: '15.0',
    releaseDate: '',
    primaryGenreName: '',
  },
  signingInfo: {
    profileType: 'missing',
    hasEmbeddedProvision: false,
    hasCodeSignature: false,
    likelyOtaInstallable: false,
    warnings: [],
    certificates: [],
    teamIdentifiers: [],
    entitlements: { getTaskAllow: false },
  },
};

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/downloads/local-test']}>
      <Routes>
        <Route path="/downloads/:id" element={<PackageDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderTaskDetail(downloadTask: DownloadTask) {
  mocks.tasks = [downloadTask];
  render(
    <MemoryRouter initialEntries={[`/downloads/${downloadTask.id}`]}>
      <Routes>
        <Route path="/downloads/:id" element={<PackageDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('upstream UI with local IPA protection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.tasks = [task];
    mocks.accounts = [];
    mocks.hashToEmail = {};
    mocks.fetchTasks.mockReset();
    mocks.analyzeSigning.mockReset();
    mocks.updateDisplayName.mockReset();
    mocks.updateVisibility.mockReset();
    mocks.updateFavorite.mockReset();
  });

  it('opens the downloaded app in its account storefront, including compound storefront IDs', () => {
    mocks.accounts = [{ email: 'hk@example.test', store: '143463-2,34' } as Account];
    mocks.hashToEmail = { 'hk-account': 'hk@example.test' };
    renderTaskDetail({ ...task, accountHash: 'hk-account', software: { ...task.software, id: 123456 } });
    const url = new URL(screen.getByRole('link', {
      name: 'search.product.openInAppStore',
    }).getAttribute('href')!);
    expect(url.searchParams.get('dsf')).toBe('143463');
    expect(url.searchParams.get('url')).toBe(
      '/WebObjects/MZStore.woa/wa/viewSoftware?mt=8&id=123456&cc=hk',
    );
  });

  it('keeps local IPA quick actions behind the details gate', () => {
    render(
      <MemoryRouter>
        <DownloadItem
          task={task}
          regionLabel="downloads.upload.localSource"
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId('package-quick-actions'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'downloads.package.title' }),
    ).toHaveAttribute('href', '/downloads/local-test');
    expect(screen.getByText('downloads.filters.region')).toBeInTheDocument();
    expect(screen.getByText('downloads.upload.localSource')).toBeInTheDocument();
  });

  it('renders compact items with only the app icon and display name', () => {
    render(
      <MemoryRouter>
        <DownloadItem
          task={task}
          compact
          regionLabel="downloads.upload.localSource"
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /My Test Build/ })).toHaveAttribute(
      'href',
      '/downloads/local-test',
    );
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
    expect(screen.queryByText('downloads.package.delete')).not.toBeInTheDocument();
    expect(
      screen.getByText('v1.0 · downloads.upload.localSource'),
    ).toBeInTheDocument();
  });

  it('requires unlocking before displaying local IPA details', () => {
    renderDetail();
    expect(
      screen.getByRole('heading', { name: 'localIpa.title' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('downloads.signing.title'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('package-quick-actions'),
    ).not.toBeInTheDocument();
  });

  it('retains signing analysis and the new quick actions after unlocking', async () => {
    sessionStorage.setItem('local-ipa-token', 'test-token');
    renderDetail();
    expect(screen.getByText('downloads.signing.title')).toBeInTheDocument();
    expect(screen.getByTestId('package-quick-actions')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'downloads.package.checkUpdate' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'downloads.signing.check' }),
    );
    await waitFor(() =>
      expect(mocks.analyzeSigning).toHaveBeenCalledWith(
        task.id,
        LOCAL_UPLOAD_ACCOUNT_HASH,
      ),
    );
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledOnce());
  });

  it('does not offer signing analysis for App Store downloads', () => {
    renderTaskDetail({
      ...task,
      id: 'store-test',
      accountHash: 'store-account',
    });

    expect(
      screen.queryByRole('button', { name: 'downloads.signing.check' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'downloads.package.checkUpdate' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'downloads.package.delete' }),
    ).toBeInTheDocument();
  });

  it('keeps visibility off by default and lets the owner enable it', async () => {
    renderTaskDetail({ ...task, accountHash: 'store-owner', canManage: true });
    const toggle = screen.getByRole('switch', { name: 'downloads.visibility.title' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.updateVisibility).toHaveBeenCalledWith(task.id, 'store-owner', true));
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledOnce());
  });

  it('favorites a package and places global visibility last', async () => {
    renderTaskDetail({ ...task, accountHash: 'store-owner', canManage: true });
    const switches = screen.getAllByRole('switch');
    expect(switches[switches.length - 1]).toHaveAccessibleName('downloads.visibility.title');
    const favorite = screen.getByRole('switch', { name: 'downloads.favorite.title' });
    expect(favorite).not.toBeChecked();
    fireEvent.click(favorite);
    await waitFor(() => expect(mocks.updateFavorite).toHaveBeenCalledWith(task.id, 'store-owner', true));
  });

  it('shows a saved shared region and region-specific links without the owner account', () => {
    renderTaskDetail({ ...task, accountHash: '', canManage: false, globallyVisible: true, storefrontId: '143463', storefrontSource: 'download', software: { ...task.software, id: 123456 } });
    expect(screen.getByText('countries.HK')).toBeInTheDocument();
    expect(document.querySelector('a[href^="https://apps.apple.com/hk/app/id123456"]')).not.toBeNull();
  });

  it('shows unknown instead of assuming US for unrecognized saved regions', () => {
    renderTaskDetail({ ...task, accountHash: '', canManage: false, globallyVisible: true, storefrontId: '999999', software: { ...task.software, id: 123456 } });
    expect(screen.getByText('downloads.region.unknown')).toBeInTheDocument();
    expect(document.querySelector('a[href^="https://apps.apple.com/"]')).toBeNull();
  });

  it('shows quick actions to a visitor without owner controls', () => {
    renderTaskDetail({ ...task, accountHash: '', globallyVisible: true, canManage: false });
    expect(screen.getByTestId('package-quick-actions')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'downloads.package.delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'downloads.package.checkUpdate' })).not.toBeInTheDocument();
  });

  it('shows the original filename and saves an editable display name', async () => {
    sessionStorage.setItem('local-ipa-token', 'test-token');
    mocks.updateDisplayName.mockResolvedValue(task);
    renderDetail();

    expect(screen.getByText('九号出行_旧版_1.0.ipa')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'My Test Build' }),
    ).toBeInTheDocument();

    const input = screen.getByLabelText('downloads.package.displayName');
    fireEvent.change(input, { target: { value: '九号出行测试版' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'downloads.package.saveDisplayName' }),
    );

    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith(
        task.id,
        '九号出行测试版',
      ),
    );
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledOnce());
  });
});
