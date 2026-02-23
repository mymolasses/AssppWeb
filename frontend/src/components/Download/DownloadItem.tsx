import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { DownloadTask } from "../../types";
import AppIcon from "../common/AppIcon";
import Badge from "../common/Badge";
import ProgressBar from "../common/ProgressBar";

interface DownloadItemProps {
  task: DownloadTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function DownloadItem({
  task,
  onPause,
  onResume,
  onDelete,
}: DownloadItemProps) {
  const { t } = useTranslation();

  const isActive = task.status === "downloading" || task.status === "injecting";
  const isPaused = task.status === "paused";
  const isCompleted = task.status === "completed";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-3 transition-colors">
      <div className="flex gap-3">
        <AppIcon
          url={task.software.artworkUrl}
          name={task.software.name}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <Link
                to={`/downloads/${task.id}`}
                className="font-medium text-sm text-gray-900 dark:text-white truncate block hover:text-blue-600 dark:hover:text-blue-400"
              >
                {task.software.name}
              </Link>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                v{task.software.version}
              </p>
            </div>
            <Badge status={task.status} />
          </div>

          {(isActive || isPaused) && (
            <div className="mt-2">
              <ProgressBar progress={task.progress} />
              <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{Math.round(task.progress)}%</span>
                {task.speed && isActive && <span>{task.speed}</span>}
              </div>
            </div>
          )}

          {task.error && (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
              {task.error}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            {isActive && (
              <button
                onClick={() => onPause(task.id)}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white font-medium transition-colors"
              >
                {t("downloads.package.pause")}
              </button>
            )}
            {isPaused && (
              <button
                onClick={() => onResume(task.id)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
              >
                {t("downloads.package.resume")}
              </button>
            )}
            {isCompleted && task.hasFile && (
              <Link
                to={`/downloads/${task.id}`}
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
              >
                {t("downloads.item.viewPackage")}
              </Link>
            )}
            <button
              onClick={() => onDelete(task.id)}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors"
            >
              {t("downloads.package.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
