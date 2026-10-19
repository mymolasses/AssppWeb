import { Router } from 'express';
import { readRemoteVersionMetadata, validateMetadataURL } from '../services/remoteVersionMetadata.js';

const router = Router();
router.post('/apple/version-metadata', async (req, res) => {
  const url = req.body?.downloadURL;
  try {
    if (typeof url !== 'string' || url.length > 16384) throw new Error('Invalid package URL');
    validateMetadataURL(url);
  } catch {
    res.status(400).json({ error: 'Invalid Apple package URL' });
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await readRemoteVersionMetadata(url));
  } catch {
    res.status(502).json({ error: 'Unable to read version metadata from IPA' });
  }
});
export default router;
