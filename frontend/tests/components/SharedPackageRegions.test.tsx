import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import DownloadList from '../../src/components/Download/DownloadList';

const mocks = vi.hoisted(() => ({
  tasks: [
    { id: 'shared-hk', accountHash: '', canManage: false, globallyVisible: true, storefrontId: '143463', hasFile: true, status: 'completed', createdAt: '2026-10-29T00:00:00Z', software: { name: 'HK shared app', version: '1', bundleID: 'com.example.hk', id: 123 } },
    { id: 'shared-unknown', accountHash: '', canManage: false, globallyVisible: true, hasFile: true, status: 'completed', createdAt: '2026-10-29T00:00:00Z', software: { name: 'Unknown shared app', version: '1', bundleID: 'com.example.unknown', id: 456 } },
  ],
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../src/hooks/useDownloads', () => ({ useDownloads: () => ({ tasks: mocks.tasks, loading: false, hashToEmail: {}, fetchTasks: vi.fn(), pauseDownload: vi.fn(), resumeDownload: vi.fn(), deleteDownload: vi.fn() }) }));
vi.mock('../../src/hooks/useAccounts', () => ({ useAccounts: () => ({ accounts: [] }) }));
vi.mock('../../src/hooks/useDownloadAction', () => ({ useDownloadAction: () => ({ startDownload: vi.fn() }) }));
afterEach(cleanup);
it('offers saved shared regions and unknown labels even with no Apple accounts', () => {
  render(<MemoryRouter><DownloadList /></MemoryRouter>);
  expect(screen.getByRole('option', { name: 'countries.HK' })).toBeInTheDocument();
  expect(screen.getAllByText('countries.HK').length).toBeGreaterThan(1);
  expect(screen.getAllByText('downloads.region.unknown').length).toBeGreaterThan(1);
});
