import { Router, Request, Response } from "express";
import {
  runSAPAuthentication,
  type SAPAuthRequest,
} from "../services/sapAuth.js";

const router = Router();

router.post("/apple/authenticate", async (req: Request, res: Response) => {
  const input = req.body as Partial<SAPAuthRequest>;
  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    typeof input.deviceId !== "string" ||
    !input.email.trim() ||
    !input.password ||
    !/^[a-fA-F0-9]{12}$/.test(input.deviceId)
  ) {
    res.status(400).json({ error: "Invalid Apple authentication request" });
    return;
  }

  try {
    const result = await runSAPAuthentication({
      email: input.email.trim(),
      password: input.password,
      authCode:
        typeof input.authCode === "string" ? input.authCode : undefined,
      deviceId: input.deviceId.toLowerCase(),
      existingCookies: Array.isArray(input.existingCookies)
        ? input.existingCookies
        : [],
    });

    if (!result.account) {
      res.status(401).json({
        error: result.error || "Apple authentication failed",
        codeRequired: result.codeRequired === true,
      });
      return;
    }

    res.json(result.account);
  } catch (error) {
    const unavailable =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    res.status(unavailable ? 503 : 502).json({
      error: unavailable
        ? "SAP authentication helper is not installed"
        : error instanceof Error
          ? error.message
          : "SAP authentication failed",
    });
  }
});

export default router;
