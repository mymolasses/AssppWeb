import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import plist from 'plist';
import bplistCreator from 'bplist-creator';
import { buildManifestFromIpa } from '../src/services/manifestBuilder.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('manifest uses the signed IPA metadata', () => {
  for (const format of ['xml', 'binary']) {
    it(`uses the build version instead of the display version (${format})`, async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asspp-manifest-'));
      directories.push(dir);
      const file = path.join(dir, 'app.ipa');
      const info = {
        CFBundleIdentifier: 'cn.ninebot.segway',
        CFBundleDisplayName: 'Test',
        CFBundleShortVersionString: '6.10.10',
        CFBundleVersion: '3831',
      };
      const zip = new AdmZip();
      zip.addFile(
        'Payload/App.app/PlugIns/Extension.appex/Info.plist',
        Buffer.from(
          plist.build({
            CFBundleIdentifier: 'wrong.extension',
            CFBundleVersion: '1',
          }),
        ),
      );
      zip.addFile(
        'Payload/App.app/Info.plist',
        format === 'xml' ? Buffer.from(plist.build(info)) : bplistCreator(info),
      );
      zip.writeZip(file);
      const before = await fs.readFile(file);
      const xml = await buildManifestFromIpa(
        file,
        'Stale title',
        'https://example.com/app.ipa',
        'https://example.com/small.png',
        'https://example.com/large.png',
      );
      const manifest = plist.parse(xml) as any;
      expect(manifest.items[0].metadata).toMatchObject({
        'bundle-identifier': 'cn.ninebot.segway',
        'bundle-version': '3831',
        title: 'Test',
      });
      expect(await fs.readFile(file)).toEqual(before);
    });
  }
});
