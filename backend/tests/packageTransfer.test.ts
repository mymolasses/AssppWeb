import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import plist from 'plist';
import install from '../src/routes/install.js';
import packages from '../src/routes/packages.js';
import { createUploadedTask, deleteTask } from '../src/services/downloadManager.js';
import { config } from '../src/config.js';
import type { Software } from '../src/types/index.js';

const app = express();
app.use('/api', install);
app.use('/api', packages);
const owner = 'a'.repeat(64);
const ids: string[] = [];
afterEach(() => { for (const id of ids.splice(0)) deleteTask(id); });
function fixture() {
  const dir = path.join(config.dataDir, 'packages');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.ipa`);
  const zip = new AdmZip();
  zip.addFile('Payload/klook.app/Info.plist', Buffer.from(plist.build({
    CFBundleIdentifier: 'com.klook.klook', CFBundleShortVersionString: '7.52.0', CFBundleVersion: '2',
  })));
  zip.addFile('Payload/klook.app/klook', Buffer.alloc(100, 42));
  zip.writeZip(file);
  const task = createUploadedTask({ id: 1, bundleID: 'com.klook.klook', name: 'Klook', version: '7.52.0' } as Software, owner, file);
  ids.push(task.id);
  return { task, bytes: fs.readFileSync(task.filePath!) };
}

describe('IPA transfer and OTA manifest', () => {
  it('uses the actual CFBundleVersion, rather than the marketing version, in the OTA manifest', async () => {
    const { task } = fixture();
    const res = await request(app).get(`/api/install/${task.id}/manifest.plist`);
    expect(res.status).toBe(200);
    const manifest = plist.parse(res.text) as any;
    expect(manifest.items[0].metadata['bundle-version']).toBe('2');
    expect(manifest.items[0].metadata['bundle-identifier']).toBe('com.klook.klook');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['install', 'download'])('supports complete, HEAD and byte range requests for %s', async kind => {
    const { task, bytes } = fixture();
    const url = kind === 'install' ? `/api/install/${task.id}/payload.ipa` : `/api/packages/${task.id}/file?accountHash=${owner}`;
    const full = await request(app).get(url);
    expect(full.status).toBe(200);
    expect(full.body).toEqual(bytes);
    expect(full.headers['content-length']).toBe(String(bytes.length));
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cache-control']).toContain('no-transform');
    expect(full.headers['x-accel-buffering']).toBe('no');
    const head = await request(app).head(url);
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(bytes.length));
    expect(head.text).toBeUndefined();
    const partial = await request(app).get(url).set('Range', 'bytes=5-17');
    expect(partial.status).toBe(206);
    expect(partial.body).toEqual(bytes.subarray(5, 18));
    expect(partial.headers['content-range']).toBe(`bytes 5-17/${bytes.length}`);
    expect(partial.headers['content-length']).toBe('13');
    const suffix = await request(app).get(url).set('Range', 'bytes=-10');
    expect(suffix.status).toBe(206);
    expect(suffix.body).toEqual(bytes.subarray(-10));
  });

  it('keeps owner checks for private packages and permits visible shared packages', async () => {
    const { task } = fixture();
    const url = `/api/packages/${task.id}/file`;
    expect((await request(app).get(url)).status).toBe(400);
    expect((await request(app).get(`${url}?accountHash=${'b'.repeat(64)}`).set('Range', 'bytes=0-1')).status).toBe(403);
    task.globallyVisible = true;
    expect((await request(app).get(url).set('Range', 'bytes=0-1')).status).toBe(206);
  });
});
