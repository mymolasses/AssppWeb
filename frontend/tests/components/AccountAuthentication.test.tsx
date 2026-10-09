import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddAccountForm from '../../src/components/Account/AddAccountForm';
import AccountDetail from '../../src/components/Account/AccountDetail';
import { authenticate, AuthenticationError } from '../../src/apple/authenticate';
import type { Account, Cookie } from '../../src/types';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), save: vi.fn(), load: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../src/apple/authenticate', async (original) => ({
  ...await original<typeof import('../../src/apple/authenticate')>(),
  authenticate: mocks.authenticate,
}));
vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({ accounts: [account], loading: false, loadAccounts: mocks.load,
    updateAccount: mocks.save, addAccount: mocks.save, removeAccount: vi.fn() }),
}));

const cookies: Cookie[] = [{ name: 'challenge', value: 'test-session', domain: 'auth.itunes.apple.com', path: '/', secure: true, httpOnly: true }];
const account: Account = {
  email: 'test@example.test', password: 'test-password', appleId: 'test@example.test',
  store: '143441', firstName: 'Test', lastName: 'User', passwordToken: 'old-token',
  directoryServicesIdentifier: '123', deviceIdentifier: 'aabbccddeeff',
  cookies: [{ ...cookies[0], value: 'old-session' }],
};

describe('two-step account authentication', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('passes challenge cookies when adding an account', async () => {
    mocks.authenticate.mockRejectedValueOnce(new AuthenticationError('code required', true, cookies))
      .mockResolvedValueOnce(account);
    render(<MemoryRouter><AddAccountForm /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('accounts.addForm.email'), { target: { value: account.email } });
    fireEvent.change(screen.getByLabelText('accounts.addForm.password'), { target: { value: account.password } });
    fireEvent.click(screen.getByRole('button', { name: 'accounts.addForm.signIn' }));
    const input = await screen.findByLabelText('accounts.addForm.code');
    fireEvent.change(input, { target: { value: '123\u00a0456' } });
    fireEvent.click(screen.getByRole('button', { name: 'accounts.addForm.verify' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(account));
    expect(vi.mocked(authenticate).mock.calls[1]).toEqual([
      account.email, account.password, '123456', cookies,
      vi.mocked(authenticate).mock.calls[0][4],
    ]);
  });

  it('retains the challenge and never starts a code-less login after verification fails', async () => {
    mocks.authenticate.mockRejectedValueOnce(new AuthenticationError('code required', true, cookies))
      .mockRejectedValueOnce(new AuthenticationError('HTTP 403', false, cookies));
    render(<MemoryRouter initialEntries={['/accounts/test@example.test']}>
      <Routes><Route path='/accounts/:email' element={<AccountDetail />} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'accounts.detail.reauth' }));
    const input = await screen.findByLabelText('accounts.detail.code');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'accounts.detail.verify' }));
    await screen.findByText('HTTP 403');
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(mocks.authenticate.mock.calls[1]).toEqual([
      account.email, account.password, '123456', cookies, account.deviceIdentifier,
    ]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
