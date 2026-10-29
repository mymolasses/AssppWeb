import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import plist from 'plist';
import bplistCreator from 'bplist-creator';
import routes from '../src/routes/downloads.js';
import packages from '../src/routes/packages.js';
import { config } from '../src/config.js';
import { createUploadedTask, deleteTask, updateTaskVisibility } from '../src/services/downloadManager.js';
import * as manager from '../src/services/downloadManager.js';
import { normalizeStorefrontId, backfillPackageRegions, readPackageStorefront } from '../src/services/packageRegions.js';
import type { Software } from '../src/types/index.js';

const app = express();app.use(express.json());app.use('/api', routes);app.use('/api', packages);
const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const ids: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const id of ids.splice(0)) deleteTask(id); });
function fixture(metadata?: Record<string, unknown>, hash = owner, binary = false) {
  const dir = path.join(config.dataDir, 'packages');fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, `${randomUUID()}.ipa`);
  const zip = new AdmZip();
  zip.addFile('Payload/App.app/Info.plist', Buffer.from(plist.build({ CFBundleIdentifier: 'com.example.regions' })));
  if (metadata) zip.addFile('iTunesMetadata.plist', binary ? bplistCreator(metadata) : Buffer.from(plist.build(metadata as any)));
  zip.writeZip(source);
  const task = createUploadedTask({ id: 123, bundleID: 'com.example.regions', version: '1', name: 'Regions' } as Software, hash, source);
  ids.push(task.id);return task;
}
it.each(['143463', '143463-2,34', 143463])('normalizes storefront %s', value => {
  expect(normalizeStorefrontId(value)).toBe('143463');
});
it('passes the normalized download account storefront to task creation', async () => {
  const task = fixture();
  const create = vi.spyOn(manager, 'createTask').mockReturnValue(task);
  const result = await request(app).post('/api/downloads').send({ software: task.software, accountHash: owner, downloadURL: 'https://iosapps.itunes.apple.com/test.ipa', sinfs: [], storefrontId: '143463-2,34' });
  expect(result.status).toBe(201);
  expect(create.mock.calls[0][6]).toBe('143463');
  const invalid = await request(app).post('/api/downloads').send({ software: task.software, accountHash: owner, downloadURL: 'https://iosapps.itunes.apple.com/test.ipa', sinfs: [], storefrontId: 'HK' });
  expect(invalid.status).toBe(400);expect(create).toHaveBeenCalledOnce();
});
it.each([null, '', 'HK', '143463evil', {}, 1, 'US-143441'])('does not guess malformed storefronts %s', value => {
  expect(normalizeStorefrontId(value)).toBeUndefined();
});
it.each([false, true])('recovers explicit storefronts from package metadata (binary=%s)', async binary => {
  const task = fixture({ storeFront: '143463-2,34' }, owner, binary);
  const retained = task.retentionStartedAt;
  await backfillPackageRegions();
  expect(task.storefrontId).toBe('143463');expect(task.storefrontSource).toBe('ipa-metadata');
  expect(task.retentionStartedAt).toBe(retained);
  expect(JSON.parse(fs.readFileSync(path.join(config.dataDir, 'tasks.json'), 'utf8')).find((t: any) => t.id === task.id).storefrontId).toBe('143463');
});
it('fills owned unknown records, shares regions without owner identity, and does not overwrite known provenance', async () => {
  const task = fixture(), otherTask = fixture(undefined, other);
  updateTaskVisibility(task.id, true);
  expect((await request(app).post('/api/downloads/regions/backfill').send({ accounts: [{ accountHash: owner, storefrontId: '143463-2,34' }] })).status).toBe(200);
  expect(task.storefrontId).toBe('143463');expect(task.storefrontSource).toBe('account');
  expect(otherTask.storefrontId).toBeUndefined();
  const guest = (await request(app).get('/api/downloads')).body.find((t: any) => t.id === task.id);
  expect(guest).toMatchObject({ storefrontId: '143463', accountHash: '', canManage: false });
  expect((await request(app).get('/api/packages')).body.find((t: any) => t.id === task.id).storefrontId).toBe('143463');
  await request(app).post('/api/downloads/regions/backfill').send({ accounts: [{ accountHash: owner, storefrontId: '143441' }] });
  expect(task.storefrontId).toBe('143463');
});
it('prefers package evidence to current account and leaves missing/conflicting evidence unknown', async () => {
  const known = fixture({ storefrontId: '143441' });
  const unknown = fixture();
  const conflict = fixture({ storeFront: '143441', storefrontId: '143463' });
  await backfillPackageRegions(new Map([[owner, '143463']]));
  expect(known.storefrontId).toBe('143441');expect(known.storefrontSource).toBe('ipa-metadata');
  expect(unknown.storefrontSource).toBe('account');
  expect(await readPackageStorefront(conflict.filePath!)).toBeUndefined();
  const noHint = fixture(undefined, other);
  await backfillPackageRegions();expect(noHint.storefrontId).toBeUndefined();
});
it('validates backfill hints and rejects conflicting account regions', async () => {
  const task = fixture();
  expect((await request(app).post('/api/downloads/regions/backfill').send({ accounts: [{ accountHash: owner, storefrontId: 'HK' }] })).status).toBe(400);
  const result = await request(app).post('/api/downloads/regions/backfill').send({ accounts: [{ accountHash: owner, storefrontId: '143441' }, { accountHash: owner, storefrontId: '143463' }] });
  expect(result.body.updated).toBe(0);expect(task.storefrontId).toBeUndefined();
});
