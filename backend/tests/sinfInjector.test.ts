import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inject } from "../src/services/sinfInjector.js";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import os from "os";
import plist from "plist";
import bplistCreator from 'bplist-creator';

const TEMP_DIR = path.join(os.tmpdir(), "sinf-injector-test");

beforeAll(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function createMockIPA(
  bundleName: string,
  opts?: {
    addManifest?: boolean;
    sinfPaths?: string[];
    executableName?: string;
  },
): string {
  const zip = new AdmZip();
  const execName = opts?.executableName ?? bundleName;

  const infoPlistXml = plist.build({
    CFBundleExecutable: execName,
    CFBundleIdentifier: `com.example.${bundleName.toLowerCase()}`,
  });
  zip.addFile(
    `Payload/${bundleName}.app/Info.plist`,
    Buffer.from(infoPlistXml),
  );
  zip.addFile(
    `Payload/${bundleName}.app/${execName}`,
    Buffer.from("fake executable"),
  );

  if (opts?.addManifest && opts?.sinfPaths) {
    const manifestPlistXml = plist.build({
      SinfPaths: opts.sinfPaths,
    });
    zip.addFile(
      `Payload/${bundleName}.app/SC_Info/Manifest.plist`,
      Buffer.from(manifestPlistXml),
    );
  }

  const ipaPath = path.join(TEMP_DIR, `${bundleName}_${Date.now()}.ipa`);
  zip.writeZip(ipaPath);
  return ipaPath;
}

describe("sinfInjector", () => {
  const record = { id: 9, sinf: Buffer.from('valid SINF fixture').toString('base64') };

  it('ignores Watch and nested manifests even when they precede the main bundle', async () => {
    const ipaPath = createMockIPA('zMain');
    const zip = new AdmZip(ipaPath);
    zip.addFile('Payload/aWatch.app/Watch/Nested.app/Info.plist', Buffer.from(plist.build({ CFBundleExecutable: 'wrong' })));
    zip.addFile('Payload/aWatch.app/Watch/Nested.app/SC_Info/Manifest.plist', Buffer.from(plist.build({ SinfPaths: ['SC_Info/wrong.sinf'] })));
    zip.addFile('Payload/zMain.app/SC_Info/Manifest.plist', bplistCreator({ SinfPaths: ['SC_Info/zMain.sinf'] }));
    zip.writeZip(ipaPath);
    await inject([record], ipaPath);
    const result = new AdmZip(ipaPath);
    expect(result.readFile('Payload/zMain.app/SC_Info/zMain.sinf')).toEqual(Buffer.from('valid SINF fixture'));
    expect(result.getEntries().filter(entry => entry.entryName.endsWith('.sinf')).map(entry => entry.entryName))
      .toEqual(['Payload/zMain.app/SC_Info/zMain.sinf']);
  });

  it.each([1, 3])('rejects %i SINF records for a two-path manifest without changing the IPA', async count => {
    const ipaPath = createMockIPA(`Count${count}`, { addManifest: true, sinfPaths: ['SC_Info/a.sinf', 'SC_Info/b.sinf'] });
    const before = fs.readFileSync(ipaPath);
    await expect(inject(Array.from({ length: count }, () => record), ipaPath)).rejects.toThrow('count');
    expect(fs.readFileSync(ipaPath)).toEqual(before);
  });

  it.each(['../outside.sinf', '/absolute.sinf', 'SC_Info/../../outside.sinf', 'SC_Info\\bad.sinf', 'SC_Info/a.txt'])('rejects invalid manifest destination %s', async destination => {
    const ipaPath = createMockIPA('InvalidPath', { addManifest: true, sinfPaths: [destination] });
    await expect(inject([record], ipaPath)).rejects.toThrow('path');
  });

  it('rejects a malformed main manifest rather than silently falling back', async () => {
    const ipaPath = createMockIPA('BadManifest');
    const zip = new AdmZip(ipaPath);
    zip.addFile('Payload/BadManifest.app/SC_Info/Manifest.plist', Buffer.from('not a plist'));
    zip.writeZip(ipaPath);
    await expect(inject([record], ipaPath)).rejects.toThrow('manifest');
  });

  it('keeps record order rather than sorting SINF IDs', async () => {
    const ipaPath = createMockIPA('Ordered', { addManifest: true, sinfPaths: ['SC_Info/a.sinf', 'SC_Info/b.sinf'] });
    await inject([record, { id: 1, sinf: Buffer.from('second').toString('base64') }], ipaPath);
    const zip = new AdmZip(ipaPath);
    expect(zip.readFile('Payload/Ordered.app/SC_Info/a.sinf')?.toString()).toBe('valid SINF fixture');
    expect(zip.readFile('Payload/Ordered.app/SC_Info/b.sinf')?.toString()).toBe('second');
    expect(zip.readFile('Payload/Ordered.app/Ordered')?.toString()).toBe('fake executable');
  });

  it.each(['', '%%%%', 'YQ='])('rejects invalid or empty base64 data', async sinf => {
    const ipaPath = createMockIPA('BadData');
    await expect(inject([{ id: 1, sinf }], ipaPath)).rejects.toThrow('SINF data');
  });
  it("should inject sinf via Info.plist fallback (no manifest)", async () => {
    const ipaPath = createMockIPA("TestApp", { executableName: "TestApp" });
    const sinfData = Buffer.from("fake sinf data for testing").toString(
      "base64",
    );

    await inject([{ id: 1, sinf: sinfData }], ipaPath);

    const resultZip = new AdmZip(ipaPath);
    const sinfEntry = resultZip.getEntry(
      "Payload/TestApp.app/SC_Info/TestApp.sinf",
    );
    expect(sinfEntry).not.toBeNull();

    const sinfContent = resultZip.readFile(sinfEntry!);
    expect(sinfContent).not.toBeNull();
    expect(sinfContent!.toString()).toBe("fake sinf data for testing");
  });

  it("should read bundle name from .app directory", async () => {
    const ipaPath = createMockIPA("MyGreatApp");
    const sinfData = Buffer.from("sinf content").toString("base64");

    await inject([{ id: 1, sinf: sinfData }], ipaPath);

    const resultZip = new AdmZip(ipaPath);
    const sinfEntry = resultZip.getEntry(
      "Payload/MyGreatApp.app/SC_Info/MyGreatApp.sinf",
    );
    expect(sinfEntry).not.toBeNull();
  });

  it("should handle multiple sinfs with manifest", async () => {
    const ipaPath = createMockIPA("MultiSinf", {
      addManifest: true,
      sinfPaths: ["SC_Info/main.sinf", "SC_Info/extension.sinf"],
    });

    const sinf1 = Buffer.from("sinf data 1").toString("base64");
    const sinf2 = Buffer.from("sinf data 2").toString("base64");

    await inject(
      [
        { id: 1, sinf: sinf1 },
        { id: 2, sinf: sinf2 },
      ],
      ipaPath,
    );

    const resultZip = new AdmZip(ipaPath);

    const entry1 = resultZip.getEntry(
      "Payload/MultiSinf.app/SC_Info/main.sinf",
    );
    expect(entry1).not.toBeNull();
    expect(resultZip.readFile(entry1!)!.toString()).toBe("sinf data 1");

    const entry2 = resultZip.getEntry(
      "Payload/MultiSinf.app/SC_Info/extension.sinf",
    );
    expect(entry2).not.toBeNull();
    expect(resultZip.readFile(entry2!)!.toString()).toBe("sinf data 2");
  });

  it("should handle empty sinfs array with no-manifest fallback", async () => {
    const ipaPath = createMockIPA("EmptyTest");
    await inject([], ipaPath);

    const resultZip = new AdmZip(ipaPath);
    const entries = resultZip
      .getEntries()
      .filter((e) => e.entryName.endsWith(".sinf"));
    expect(entries.length).toBe(0);
  });

  it("should throw if IPA has no .app directory", async () => {
    const zip = new AdmZip();
    zip.addFile("SomeFile.txt", Buffer.from("not an IPA"));
    const ipaPath = path.join(TEMP_DIR, "invalid.ipa");
    zip.writeZip(ipaPath);

    const sinfData = Buffer.from("sinf").toString("base64");
    await expect(
      inject([{ id: 1, sinf: sinfData }], ipaPath),
    ).rejects.toThrow();
  });

  it("should use different executable name from CFBundleExecutable", async () => {
    const ipaPath = createMockIPA("AppBundle", {
      executableName: "CustomExec",
    });
    const sinfData = Buffer.from("sinf").toString("base64");

    await inject([{ id: 1, sinf: sinfData }], ipaPath);

    const resultZip = new AdmZip(ipaPath);
    // Should use CFBundleExecutable (CustomExec), not bundle name (AppBundle)
    const sinfEntry = resultZip.getEntry(
      "Payload/AppBundle.app/SC_Info/CustomExec.sinf",
    );
    expect(sinfEntry).not.toBeNull();
  });

  it("should prefer manifest over Info.plist when both exist", async () => {
    const ipaPath = createMockIPA("WithManifest", {
      addManifest: true,
      sinfPaths: ["SC_Info/custom.sinf"],
      executableName: "WithManifest",
    });

    const sinfData = Buffer.from("manifest sinf").toString("base64");
    await inject([{ id: 1, sinf: sinfData }], ipaPath);

    const resultZip = new AdmZip(ipaPath);
    // Should inject at manifest-specified path, not Info.plist path
    const manifestEntry = resultZip.getEntry(
      "Payload/WithManifest.app/SC_Info/custom.sinf",
    );
    expect(manifestEntry).not.toBeNull();
    expect(resultZip.readFile(manifestEntry!)!.toString()).toBe(
      "manifest sinf",
    );
  });
});
