import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, AuthenticationError, clearAuthenticationSession } from '../../src/apple/authenticate';
import { useOperations } from '../../src/store/operations';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), calls: vi.fn() }));
vi.mock('../../src/api/client', () => ({ authHeaders: () => ({}) }));
vi.mock('../../src/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../src/apple/browserAuthenticate', () => {
  class BrowserError extends Error {
    constructor(
      message: string,
      public codeRequired = false,
    ) {
      super(message);
    }
  }
  return {
    AuthenticationError: BrowserError,
    Authenticator: class {
      constructor(device: string) {
        mocks.connect(device);
      }
      authenticate(...args: unknown[]) {
        return mocks.calls(...args);
      }
    },
  };
});

describe('explicit authentication modes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.connect.mockReset();
    mocks.calls.mockReset();
    clearAuthenticationSession('aabbccddeeff');
  });
  it('never sends credentials to the server when Browser SAP fails', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    mocks.calls.mockRejectedValue(new Error('browser signature failed'));
    await expect(
      authenticate('test@example.invalid', 'fixture', undefined, [], 'aabbccddeeff', 'browser'),
    ).rejects.toThrow('browser signature failed');
    expect(network).not.toHaveBeenCalled();
    expect(useOperations.getState().active).toEqual([]);
  });
  it('retains the same browser signer and GUID across a verification challenge', async () => {
    const { AuthenticationError: BrowserError } = await import('../../src/apple/browserAuthenticate');
    mocks.calls
      .mockRejectedValueOnce(new BrowserError('code required', true))
      .mockResolvedValueOnce({ email: 'test@example.invalid', deviceIdentifier: 'aabbccddeeff' });
    await expect(
      authenticate('test@example.invalid', 'fixture', undefined, [], 'aabbccddeeff', 'browser'),
    ).rejects.toBeInstanceOf(AuthenticationError);
    const result = await authenticate('test@example.invalid', 'fixture', '012345', [], 'aabbccddeeff', 'browser');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(result.authMethod).toBe('browser');
    expect(mocks.calls.mock.calls[1][2]).toBe('012345');
  });
  it('returns Anisette challenge state to the next request without changing GUID', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'code required', codeRequired: true, nativeState: 'Zml4dHVyZQ==' }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            passwordToken: 'fixture-token',
            directoryServicesIdentifier: '123',
            deviceIdentifier: 'aabbccddeeff',
            nativeState: 'bmV4dA==',
          }),
        ),
      );
    await expect(
      authenticate('test@example.invalid', 'fixture', undefined, [], 'aabbccddeeff', 'native'),
    ).rejects.toBeInstanceOf(AuthenticationError);
    const result = await authenticate('test@example.invalid', 'fixture', '012345', [], 'aabbccddeeff', 'native');
    const body = JSON.parse(network.mock.calls[1][1]!.body as string);
    expect(body.nativeState).toBe('Zml4dHVyZQ==');
    expect(body.deviceId).toBe('aabbccddeeff');
    expect(result.authMethod).toBe('native');
    expect(useOperations.getState().active).toEqual([]);
  });
});
