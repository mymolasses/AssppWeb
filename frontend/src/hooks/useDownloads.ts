import { useEffect, useRef, useState } from "react";
import { useDownloadsStore } from "../store/downloads";
import { useAccounts } from "./useAccounts";
import { backfillDownloadRegions } from '../api/downloads';
import { accountHash } from "../utils/account";
import { LOCAL_UPLOAD_ACCOUNT_HASH } from "../constants/downloads";

export function useDownloads() {
  const {
    tasks,
    loading,
    setAccountHashes,
    fetchTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  } = useDownloadsStore();
  const { accounts } = useAccounts();
  const hashesRef = useRef("");
  const [hashToEmail, setHashToEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Calculate original hashes preserving the order corresponding to 'accounts'
      const hashes = await Promise.all(accounts.map((a) => accountHash(a)));
      // Use slice() before sort() so we don't mutate the original 'hashes' array
      const allHashes = [...hashes, LOCAL_UPLOAD_ACCOUNT_HASH];
      const key = allHashes.slice().sort().join(",") + accounts.map(a => a.store).join(",");
      if (cancelled || key === hashesRef.current) return;
      hashesRef.current = key;

      const map: Record<string, string> = {};
      for (let i = 0; i < accounts.length; i++) {
        // Now hashes[i] correctly maps to accounts[i]
        map[hashes[i]] = accounts[i].email;
      }
      map[LOCAL_UPLOAD_ACCOUNT_HASH] = "Local IPA";
      setHashToEmail(map);

      setAccountHashes(allHashes);
      // Fetch immediately after hashes are set so downloads appear on first visit
      const hints = accounts.flatMap((account, index) => /^\d{6}(?:[-,].*)?$/.test(account.store?.trim() ?? '')
        ? [{ accountHash: hashes[index], storefrontId: account.store }] : []);
      if (cancelled) return;
      await fetchTasks();
      if (hints.length && !cancelled) {
        try {
          const result = await backfillDownloadRegions(hints);
          if (result.updated > 0 && !cancelled) await fetchTasks();
        } catch { /* Region backfill must not block ordinary browsing. */ }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, setAccountHashes, fetchTasks]);

  return {
    tasks,
    loading,
    hashToEmail,
    fetchTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  };
}
