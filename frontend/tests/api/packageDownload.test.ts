import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { downloadPackage } from '../../src/api/packageDownload';

class FakeXHR {
  static last: FakeXHR;
  status = 200;
  response: Blob = new Blob(['IPA']);
  responseType = '';
  headers: Record<string, string> = {};
  onprogress?: (event: Partial<ProgressEvent>) => void;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  constructor() { FakeXHR.last = this; }
}
beforeEach(() => { vi.stubGlobal('XMLHttpRequest', FakeXHR); sessionStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('keeps access authentication and reports received bytes before completion', async () => {
  sessionStorage.setItem('auth-token', 'test-token');
  const progress = vi.fn();
  const pending = downloadPackage('task', 'owner', progress, new AbortController().signal);
  const xhr = FakeXHR.last;
  expect(xhr.open).toHaveBeenCalledWith('GET', '/api/packages/task/file?accountHash=owner');
  expect(xhr.headers).toEqual({ 'X-Access-Token': 'test-token' });
  expect(xhr.responseType).toBe('blob');
  xhr.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
  expect(progress).toHaveBeenLastCalledWith({ loaded: 25, total: 100 });
  xhr.onload?.();
  await expect(pending).resolves.toBe(xhr.response);
});

it('reports bytes without inventing a percentage when the total is unavailable', async () => {
  const progress = vi.fn();
  const pending = downloadPackage('task', '', progress, new AbortController().signal);
  FakeXHR.last.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 });
  expect(progress).toHaveBeenLastCalledWith({ loaded: 25, total: undefined });
  FakeXHR.last.onload?.();
  await pending;
});

it('cancels an in-flight download and detaches its listener after finishing', async () => {
  const controller = new AbortController();
  const pending = downloadPackage('task', '', vi.fn(), controller.signal);
  const xhr = FakeXHR.last;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(xhr.abort).toHaveBeenCalledOnce();
  const finished = new AbortController();
  const next = downloadPackage('task', '', vi.fn(), finished.signal);
  const completeXHR = FakeXHR.last;
  completeXHR.onload?.();
  await next;
  finished.abort();
  expect(completeXHR.abort).not.toHaveBeenCalled();
});

it('rejects an HTTP failure without offering its error body as an IPA', async () => {
  const pending = downloadPackage('task', '', vi.fn(), new AbortController().signal);
  FakeXHR.last.status = 401;
  FakeXHR.last.onload?.();
  await expect(pending).rejects.toThrow('failed');
});
