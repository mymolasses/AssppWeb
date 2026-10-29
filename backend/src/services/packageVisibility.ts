import fs from 'node:fs';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../constants.js';
import { sanitizeTaskForResponse } from './downloadManager.js';
import type { DownloadTask } from '../types/index.js';

export function isGloballyVisible(task: DownloadTask): boolean {
  return task.globallyVisible === true && task.accountHash !== LOCAL_UPLOAD_ACCOUNT_HASH &&
    task.status === 'completed' && !!task.filePath && fs.existsSync(task.filePath);
}

export function taskForViewer(task: DownloadTask, owner: boolean) {
  return {
    ...sanitizeTaskForResponse(task),
    globallyVisible: isGloballyVisible(task),
    accountHash: owner ? task.accountHash : '',
    canManage: owner,
  };
}
