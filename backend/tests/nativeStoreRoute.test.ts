import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../src/services/sapAuth.js', () => ({
  runSAPAuthentication: vi.fn(),
  runSAPKBSync: vi.fn(),
  runSAPHelper: mocks.run,
}));
import appleRoutes from '../src/routes/appleAuth.js';
const app = express();
app.use(express.json());
app.use('/api', appleRoutes);
const payload = {
  operation: 'purchase',
  account: {
    email: 'fixture@example.invalid',
    password: 'not-forwarded',
    passwordToken: 'fixture-token',
    directoryServicesIdentifier: '123',
    deviceIdentifier: 'aabbccddeeff',
    store: '143441',
    cookies: [],
    nativeState: 'Zml4dHVyZQ==',
  },
  app: { id: 123, bundleID: 'fixture.app', name: 'Fixture', version: '1.0' },
};
describe('native Store request boundary', () => {
  beforeEach(() => {
    mocks.run.mockReset();
  });
  it('whitelists operations, strips login passwords and forwards returned state', async () => {
    mocks.run.mockResolvedValue({ alreadyOwned: true, nativeState: 'bmV3' });
    const response = await request(app).post('/api/apple/store').send(payload);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mocks.run.mock.calls[0][0].account).not.toHaveProperty('password');
    expect(mocks.run.mock.calls[0][0].app).toMatchObject({ trackId: 123, bundleId: 'fixture.app' });
    expect(response.body.nativeState).toBe('bmV3');
  });
  it.each(['prepare-ipa', 'shell', 'file'])('rejects an unexposed operation %s', async (operation) => {
    const response = await request(app)
      .post('/api/apple/store')
      .send({ ...payload, operation });
    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('does not expose native stderr or server paths when the helper fails', async () => {
    mocks.run.mockRejectedValue(new Error('fixture-secret /server/private/path'));
    const response = await request(app).post('/api/apple/store').send(payload);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
  });
});
