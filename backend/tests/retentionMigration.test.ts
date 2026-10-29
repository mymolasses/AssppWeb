import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

it('gives old packages one grace period, preserves favorites across restarts, then removes expired non-favorites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asspp-retention-'));
  const filePath = path.join(dir, 'packages', 'old.ipa');
  fs.mkdirSync(path.dirname(filePath)); fs.writeFileSync(filePath, 'fixture');
  const store = path.join(dir, 'tasks.json');
  const task = { id: 'old', storefrontId: '143463', storefrontSource: 'download', software: {}, accountHash: 'owner', status: 'completed', filePath, createdAt: '2020-01-01T00:00:00Z' };
  fs.writeFileSync(store, JSON.stringify([task]));
  const moduleURL = pathToFileURL(path.resolve('src/services/downloadManager.ts')).href;
  const restart = () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `await import(${JSON.stringify(moduleURL)}); process.exit(0);`], {
      env: { ...process.env, DATA_DIR: dir, AUTO_CLEANUP_DAYS: '14', AUTO_CLEANUP_MAX_MB: '0' }, encoding: 'utf8', timeout: 20000,
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(fs.readFileSync(store, 'utf8'));
  };
  try {
    const first = restart();
    expect(first).toHaveLength(1);
    expect(first[0].storefrontId).toBe('143463');
    expect(first[0].storefrontSource).toBe('download');
    const started = first[0].retentionStartedAt;
    expect(Date.parse(started)).toBeGreaterThan(Date.now() - 10000);
    expect(restart()[0].retentionStartedAt).toBe(started);
    first[0].retentionStartedAt = '2020-01-01T00:00:00Z'; first[0].favorite = true;
    fs.writeFileSync(store, JSON.stringify(first));
    expect(restart()[0].favorite).toBe(true);
    first[0].favorite = false; fs.writeFileSync(store, JSON.stringify(first));
    expect(restart()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
