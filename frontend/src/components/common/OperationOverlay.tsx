import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../store/operations';

export default function OperationOverlay() {
  const { t } = useTranslation();
  const active = useOperations((s) => s.active);
  const operation = active[active.length - 1];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!operation) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [operation?.id]);
  if (!operation) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('operation.' + operation.kind)}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl dark:bg-gray-900"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span
          className="mx-auto mb-5 block h-10 w-10 animate-spin rounded-full border-[3px] border-blue-100 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-400"
          aria-hidden="true"
        />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('operation.' + operation.kind)}</h2>
        {operation.mode && (
          <p className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400">{t('authMode.' + operation.mode)}</p>
        )}
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{operation.detail || t('operation.wait')}</p>
        <p className="mt-4 text-xs tabular-nums text-gray-400">
          {t('operation.elapsed', { seconds: Math.max(0, Math.floor((now - operation.started) / 1000)) })}
        </p>
      </div>
    </div>
  );
}
