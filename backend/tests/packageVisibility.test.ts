import { afterEach, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import downloads from '../src/routes/downloads.js';
import packages from '../src/routes/packages.js';
import { config } from '../src/config.js';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../src/constants.js';
import { createUploadedTask, deleteTask, runTimeCleanup, runSpaceCleanup, getTask } from '../src/services/downloadManager.js';
import type { Software } from '../src/types/index.js';

const owner = 'a'.repeat(64);
const app = express();
app.use(express.json()); app.use('/api', downloads); app.use('/api', packages);
const ids: string[] = [];
afterEach(() => { for (const id of ids.splice(0)) deleteTask(id); });
function fixture(hash = owner) {
  const source = path.join(config.dataDir, 'packages', `${randomUUID()}.ipa`);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'ipa test contents');
  const task = createUploadedTask({ id: 123, name: 'Shared', bundleID: 'com.example.shared', version: '1.0' } as Software, hash, source);
  ids.push(task.id); return task;
}
it('is private by default, persists opt-in, supports a second device, and revokes browsing and download on opt-out', async () => {
  const task = fixture();
  expect((await request(app).get('/api/downloads')).body).toEqual([]);
  expect((await request(app).get(`/api/packages/${task.id}/file`)).status).toBe(400);
  const endpoint = `/api/downloads/${task.id}/visibility?accountHash=${owner}`;
  expect((await request(app).post(endpoint).send({ globallyVisible: true })).status).toBe(200);
  const saved = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'tasks.json'), 'utf8'));
  expect(saved.find((item: any) => item.id === task.id).globallyVisible).toBe(true);
  const guest = (await request(app).get('/api/downloads')).body[0];
  expect(guest).toMatchObject({ id: task.id, canManage: false, accountHash: '', globallyVisible: true, hasFile: true });
  expect(guest).not.toHaveProperty('downloadURL');
  expect(guest).not.toHaveProperty('filePath');
  expect((await request(app).get('/api/packages')).body[0].accountHash).toBe('');
  expect((await request(app).get(`/api/downloads/${task.id}`)).body.canManage).toBe(false);
  expect((await request(app).get(`/api/packages/${task.id}/file`)).status).toBe(200);
  expect((await request(app).get(`/api/downloads?accountHashes=${owner}`)).body[0].canManage).toBe(true);
  expect((await request(app).delete(`/api/packages/${task.id}`)).status).toBe(400);
  expect((await request(app).post(`/api/downloads/${task.id}/visibility`).send({ globallyVisible: false })).status).toBe(400);
  await request(app).post(endpoint).send({ globallyVisible: false });
  expect((await request(app).get('/api/downloads')).body).toEqual([]);
  expect((await request(app).get(`/api/packages/${task.id}/file`)).status).toBe(400);
});
it('rejects non-owner changes, invalid values, unfinished packages and local uploads', async () => {
  const task = fixture();
  expect((await request(app).post(`/api/downloads/${task.id}/visibility?accountHash=${'b'.repeat(64)}`).send({ globallyVisible: true })).status).toBe(403);
  expect((await request(app).post(`/api/downloads/${task.id}/visibility?accountHash=${owner}`).send({ globallyVisible: 'true' })).status).toBe(400);
  task.status = 'downloading';
  expect((await request(app).post(`/api/downloads/${task.id}/visibility?accountHash=${owner}`).send({ globallyVisible: true })).status).toBe(400);
  task.status = 'completed';
  const local = fixture(LOCAL_UPLOAD_ACCOUNT_HASH);
  expect((await request(app).post(`/api/downloads/${local.id}/visibility?accountHash=${LOCAL_UPLOAD_ACCOUNT_HASH}`).send({ globallyVisible: true })).status).toBe(400);
});

it('protects favorites from time and space cleanup, and restarts retention when unfavorited', async () => {
  const task = fixture();
  const oldDays = config.autoCleanupDays;
  const oldMax = config.autoCleanupMaxMB;
  try {
    config.autoCleanupDays = 14;
    task.retentionStartedAt = new Date(Date.now() - 15 * 86400000).toISOString();
    const endpoint = `/api/downloads/${task.id}/favorite?accountHash=${owner}`;
    expect((await request(app).post(endpoint).send({ favorite: true })).status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'tasks.json'), 'utf8'));
    expect(saved.find((item: any) => item.id === task.id).favorite).toBe(true);
    runTimeCleanup();
    config.autoCleanupMaxMB = 0.000001;
    runSpaceCleanup();
    expect(getTask(task.id)?.favorite).toBe(true);
    expect(fs.existsSync(task.filePath!)).toBe(true);
    expect((await request(app).post(endpoint).send({ favorite: false })).status).toBe(200);
    expect(Date.parse(task.retentionStartedAt!)).toBeGreaterThan(Date.now() - 5000);
    runTimeCleanup();
    expect(getTask(task.id)).toBeDefined();
    task.retentionStartedAt = new Date(Date.now() - 15 * 86400000).toISOString();
    runTimeCleanup();
    expect(getTask(task.id)).toBeUndefined();
    expect(fs.existsSync(task.filePath!)).toBe(false);
  } finally { config.autoCleanupDays = oldDays; config.autoCleanupMaxMB = oldMax; }
});

it('restricts favorite changes to owners and retains the local IPA password gate', async () => {
  const task = fixture();
  expect((await request(app).post(`/api/downloads/${task.id}/favorite?accountHash=${'b'.repeat(64)}`).send({ favorite: true })).status).toBe(403);
  expect((await request(app).post(`/api/downloads/${task.id}/favorite?accountHash=${owner}`).send({ favorite: 'true' })).status).toBe(400);
  const local = fixture(LOCAL_UPLOAD_ACCOUNT_HASH);
  expect((await request(app).post(`/api/downloads/${local.id}/favorite?accountHash=${LOCAL_UPLOAD_ACCOUNT_HASH}`).send({ favorite: true })).status).toBe(403);
});
