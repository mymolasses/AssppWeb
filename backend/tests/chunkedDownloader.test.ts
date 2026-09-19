import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ChunkedDownloader } from "../src/services/chunkedDownloader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.promises.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("ChunkedDownloader", () => {
  it("falls back to one stream when a server advertises but ignores ranges", async () => {
    const body = Buffer.from("a complete IPA response");
    let rangeRequests = 0;
    let fullRequests = 0;
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Length", body.length);
      res.setHeader("Accept-Ranges", "bytes");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      if (req.headers.range) rangeRequests++;
      else fullRequests++;
      // Deliberately ignore Range and return 200, as some CDNs do.
      res.statusCode = 200;
      res.end(body);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing port");
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "asspp-range-"));
      tempDirs.push(tempDir);
      const destination = path.join(tempDir, "app.ipa");
      const downloader = new ChunkedDownloader(
        `http://127.0.0.1:${address.port}/app.ipa`,
        destination,
        { threads: 4 },
      );

      await downloader.download(new AbortController().signal);

      expect(await fs.promises.readFile(destination)).toEqual(body);
      expect(rangeRequests).toBe(1);
      expect(fullRequests).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
