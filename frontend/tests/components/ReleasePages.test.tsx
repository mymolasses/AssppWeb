import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import HomePage from '../../src/components/Welcome/HomePage';
import SettingsPage from '../../src/components/Settings/SettingsPage';
import { APP_VERSION } from '../../src/utils/appVersion';

const accounts: any[] = [];
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US', changeLanguage: vi.fn() } }) }));
vi.mock('../../src/hooks/useAccounts', () => ({ useAccounts: () => ({ accounts }) }));
vi.mock('../../src/api/client', () => ({ apiGet: vi.fn(async (url: string) => url === '/api/settings' ? { appVersion: '1.2.1' } : [{ id: 'shared', globallyVisible: true, software: { name: 'Shared app fixture' } }]) }));
afterEach(cleanup);
it('shows the package version on home without rendering shared app cards', async () => {
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(screen.getByText(`App Store · AssppWeb v${APP_VERSION}`)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Shared app fixture')).not.toBeInTheDocument());
  expect(screen.queryByLabelText('downloads.visibility.sharedApps')).not.toBeInTheDocument();
});
it('shows the same package version in settings', () => {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  expect(screen.getByText(`AssppWeb v${APP_VERSION}`)).toBeInTheDocument();
});
