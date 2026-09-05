import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadItem from '../../src/components/Download/DownloadItem';
import PackageDetail from '../../src/components/Download/PackageDetail';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../../src/constants/downloads';
import type { DownloadTask } from '../../src/types';

const mocks = vi.hoisted(() => ({
  tasks: [] as DownloadTask[],
  fetchTasks: vi.fn(),
  analyzeSigning: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../src/hooks/useDownloads', () => ({
  useDownloads: () => ({
    tasks: mocks.tasks,
    hashToEmail: {},
    fetchTasks: mocks.fetchTasks,
  }),
}));
vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({ accounts: [] }),
}));
vi.mock('../../src/hooks/useDownloadAction', () => ({
  useDownloadAction: () => ({ startDownload: vi.fn() }),
}));
vi.mock('../../src/api/downloads', () => ({
  analyzeDownloadSigning: mocks.analyzeSigning,
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

describe('upstream UI with local IPA protection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.tasks = [task];
    mocks.fetchTasks.mockReset();
    mocks.analyzeSigning.mockReset();
  });

  it('keeps local IPA quick actions behind the details gate', () => {
    render(
      <MemoryRouter>
        <DownloadItem
          task={task}
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
});
