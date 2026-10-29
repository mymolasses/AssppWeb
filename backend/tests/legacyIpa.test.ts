import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import plist from 'plist';
import bplistCreator from 'bplist-creator';
import { readIpaInfo } from '../src/services/ipaMetadata.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function ipa(info: Record<string, any>, binary = false, entry = 'Payload/Old.app/Info.plist') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-ipa-'));dirs.push(dir);
  const zip = new AdmZip();
  zip.addFile(entry, binary ? bplistCreator(info) : Buffer.from(plist.build(info)));
  const file = path.join(dir, 'test.ipa');zip.writeZip(file);return file;
}
it.each([false, true])('accepts old iOS packages without a platform declaration (binary=%s)', async (binary) => {
  const file = ipa({ CFBundleIdentifier: 'com.example.old', CFBundleShortVersionString: '1.0' }, binary);
  await expect(readIpaInfo(file, 'Old', 'com.example.old')).resolves.toMatchObject({ bundleID: 'com.example.old', version: '1.0' });
});
it.each([[], ['AppleTVOS'], ['WatchOS'], ['XROS'], ['MacOSX'], '', 1])('rejects empty, malformed or conflicting platform declarations: %j', async (platforms) => {
  const file = ipa({ CFBundleIdentifier: 'com.example.old', CFBundleSupportedPlatforms: platforms });
  await expect(readIpaInfo(file, 'Old', 'com.example.old')).rejects.toThrow('iPhoneOS');
});
it('accepts explicit iOS support and rejects a wrong app identity', async () => {
  const file = ipa({ CFBundleIdentifier: 'com.example.old', CFBundleSupportedPlatforms: ['iPhoneOS'] });
  await expect(readIpaInfo(file, 'Old', 'com.example.old')).resolves.toBeDefined();
  await expect(readIpaInfo(file, 'Old', 'com.other.app')).rejects.toThrow('bundle identifier');
});
it('does not use an embedded app plist to validate the main app', async () => {
  const file = ipa({ CFBundleIdentifier: 'com.example.old' }, false, 'Payload/Old.app/PlugIns/Inner.app/Info.plist');
  await expect(readIpaInfo(file, 'Old', 'com.example.old')).rejects.toThrow('Could not find');
});
