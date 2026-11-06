import type { Request, Response, NextFunction } from 'express';

// sendFile implements HEAD, Content-Length and byte ranges. Avoid intermediary
// buffering/encoding so browsers and the OTA installer receive bytes promptly.
export function sendPackageFile(req: Request, res: Response, next: NextFunction, filePath: string) {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.sendFile(filePath, { cacheControl: false }, error => {
    if (!error || req.destroyed || res.destroyed) return;
    if (res.headersSent) res.destroy();
    else next(error);
  });
}
