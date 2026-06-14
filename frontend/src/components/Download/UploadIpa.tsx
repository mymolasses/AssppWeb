import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import ProgressBar from "../common/ProgressBar";
import { uploadIpa } from "../../api/downloads";
import { useDownloadsStore } from "../../store/downloads";
import { useToastStore } from "../../store/toast";
import { getErrorMessage } from "../../utils/error";

export default function UploadIpa() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fetchTasks = useDownloadsStore((s) => s.fetchTasks);
  const addToast = useToastStore((s) => s.addToast);

  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    try {
      const task = await uploadIpa(file, setProgress);
      await fetchTasks();
      addToast(t("downloads.upload.success"), "success");
      navigate(`/downloads/${task.id}`);
    } catch (err) {
      addToast(getErrorMessage(err, t("downloads.upload.failed")), "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageContainer title={t("downloads.upload.title")}>
      <form onSubmit={handleUpload} className="space-y-6">
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 p-6 text-center cursor-pointer hover:border-green-500 dark:hover:border-green-500 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".ipa,application/octet-stream"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setProgress(0);
            }}
          />
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              />
            </svg>
          </div>
          <p className="text-base font-medium text-gray-900 dark:text-white">
            {file ? file.name : t("downloads.upload.choose")}
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t("downloads.upload.help")}
          </p>
        </div>

        {uploading && (
          <div className="space-y-2">
            <ProgressBar progress={progress} />
            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>{t("downloads.upload.uploading")}</span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {t("downloads.upload.note")}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!file || uploading}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? t("downloads.upload.uploading") : t("downloads.upload.submit")}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => navigate("/downloads")}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {t("settings.data.cancel")}
          </button>
        </div>
      </form>
    </PageContainer>
  );
}
