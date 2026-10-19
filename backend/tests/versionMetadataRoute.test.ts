import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from '../src/routes/versionMetadata.js';
import { readRemoteVersionMetadata } from '../src/services/remoteVersionMetadata.js';

vi.mock('../src/services/remoteVersionMetadata.js', async (original) => ({
  ...await original<typeof import('../src/services/remoteVersionMetadata.js')>(),
  readRemoteVersionMetadata: vi.fn(),
}));
const app = express();
app.use(express.json());
app.use('/api', router);
beforeEach(() => vi.resetAllMocks());

it('returns the date source without caching signed package URLs', async () => {
  const metadata = { displayVersion: '2', date: '2020-01-01T00:00:00Z', dateSource: 'file-modified' };
  vi.mocked(readRemoteVersionMetadata).mockResolvedValue(metadata);
  const response = await request(app).post('/api/apple/version-metadata').send({ downloadURL: 'https://apps.apple.com/app.ipa' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(metadata);
  expect(response.headers['cache-control']).toBe('no-store');
});
it('rejects non-Apple URLs before attempting a read', async () => {
  const response = await request(app).post('/api/apple/version-metadata').send({ downloadURL: 'http://127.0.0.1/private' });
  expect(response.status).toBe(400);
  expect(readRemoteVersionMetadata).not.toHaveBeenCalled();
});
it('reports unreadable packages without leaking signed URLs', async () => {
  vi.mocked(readRemoteVersionMetadata).mockRejectedValue(new Error('secret signed URL'));
  const response = await request(app).post('/api/apple/version-metadata').send({ downloadURL: 'https://apps.apple.com/app.ipa' });
  expect(response.status).toBe(502);
  expect(JSON.stringify(response.body)).not.toContain('secret');
});
