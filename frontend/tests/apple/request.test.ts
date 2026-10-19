import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appleRequest } from '../../src/apple/request';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), init: vi.fn() }));
vi.mock('../../src/apple/libcurl-init', () => ({ libcurl: { fetch: mocks.fetch }, initLibcurl: mocks.init }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.init.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue({
    status: 200, statusText: 'OK', raw_headers: [], text: async () => '',
  });
});

describe('browser Store request cancellation', () => {
  it('forwards AbortSignal and keeps redirects manual', async () => {
    const controller = new AbortController();
    await appleRequest({ host: 'buy.itunes.apple.com', path: '/test', method: 'POST', signal: controller.signal });
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal, redirect: 'manual', _libcurl_http_version: 1.1 });
  });

  it('does not initialize or send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(appleRequest({ host: 'buy.itunes.apple.com', path: '/test', method: 'POST', signal: controller.signal })).rejects.toThrow();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not send a request whose deadline elapsed during WASM initialization', async () => {
    let ready!: () => void;
    mocks.init.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const controller = new AbortController();
    const request = appleRequest({ host: 'buy.itunes.apple.com', path: '/test', method: 'POST', signal: controller.signal });
    controller.abort();
    ready();
    await expect(request).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
