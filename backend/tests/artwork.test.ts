import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadArtwork,
  validateArtworkURL,
} from "../src/services/artwork.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IPA artwork", () => {
  it("accepts Apple artwork hosts and rejects arbitrary hosts", () => {
    expect(
      validateArtworkURL("https://is1-ssl.mzstatic.com/image/thumb/test.jpg")
        .hostname,
    ).toBe("is1-ssl.mzstatic.com");
    expect(() => validateArtworkURL("http://is1-ssl.mzstatic.com/test.jpg"))
      .toThrow("HTTPS");
    expect(() => validateArtworkURL("https://example.com/test.jpg"))
      .toThrow("Apple artwork host");
  });

  it("downloads non-empty image data", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        url: "https://is1-ssl.mzstatic.com/image/thumb/test.png",
        headers: new Headers({
          "content-length": String(bytes.length),
          "content-type": "image/png",
        }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      }),
    );

    const artwork = await downloadArtwork(
      "https://is1-ssl.mzstatic.com/image/thumb/test.png",
    );

    expect(artwork).toEqual(Buffer.from(bytes));
  });
});
