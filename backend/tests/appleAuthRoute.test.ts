import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import appleAuthRoutes from "../src/routes/appleAuth.js";
import { runSAPAuthentication } from "../src/services/sapAuth.js";

vi.mock("../src/services/sapAuth.js", () => ({
  runSAPAuthentication: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", appleAuthRoutes);
  return app;
}

describe("Apple SAP authentication route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates the device identifier", async () => {
    const response = await request(createApp())
      .post("/api/apple/authenticate")
      .send({ email: "test@example.com", password: "secret", deviceId: "bad" });

    expect(response.status).toBe(400);
    expect(runSAPAuthentication).not.toHaveBeenCalled();
  });

  it("returns the helper account without logging or transforming secrets", async () => {
    vi.mocked(runSAPAuthentication).mockResolvedValue({
      account: {
        email: "test@example.com",
        appleId: "test@example.com",
        store: "143441",
        firstName: "Test",
        lastName: "User",
        passwordToken: "token",
        directoryServicesIdentifier: "123",
        cookies: [],
        deviceIdentifier: "aabbccddeeff",
      },
    });

    const response = await request(createApp())
      .post("/api/apple/authenticate")
      .send({
        email: " test@example.com ",
        password: "secret",
        authCode: "123 456",
        deviceId: "AABBCCDDEEFF",
      });

    expect(response.status).toBe(200);
    expect(response.body.passwordToken).toBe("token");
    expect(runSAPAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
        password: "secret",
        deviceId: "aabbccddeeff",
      }),
    );
  });

  it("maps an ipatool 2FA challenge to a 401 response", async () => {
    vi.mocked(runSAPAuthentication).mockResolvedValue({
      error: "auth code is required",
      codeRequired: true,
    });

    const response = await request(createApp())
      .post("/api/apple/authenticate")
      .send({
        email: "test@example.com",
        password: "secret",
        deviceId: "aabbccddeeff",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "auth code is required",
      codeRequired: true,
    });
  });
});
