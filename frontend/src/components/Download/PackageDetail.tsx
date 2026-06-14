import { useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import PageContainer from "../Layout/PageContainer";
import AppIcon from "../common/AppIcon";
import Badge from "../common/Badge";
import ProgressBar from "../common/ProgressBar";
import Modal from "../common/Modal";
import { useDownloads } from "../../hooks/useDownloads";
import { useAccounts } from "../../hooks/useAccounts";
import { useDownloadAction } from "../../hooks/useDownloadAction";
import { useToastStore } from "../../store/toast";
import { getInstallInfo } from "../../api/install";
import { analyzeDownloadSigning } from "../../api/downloads";
import { authHeaders } from "../../api/client";
import { lookupApp } from "../../api/search";
import { storeIdToCountry } from "../../apple/config";
import { listVersions } from "../../apple/versionFinder";
import { getAccountContext } from "../../utils/toast";
import { isNewerVersion } from "../../utils/version";
import { LOCAL_UPLOAD_ACCOUNT_HASH } from "../../constants/downloads";
import type { IpaSigningInfo, Software } from "../../types";

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function certLabel(subject: string) {
  const cn = subject
    .split("\n")
    .find((part) => part.startsWith("CN="))
    ?.slice(3);
  return cn || subject;
}

export default function PackageDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    tasks,
    deleteDownload,
    pauseDownload,
    resumeDownload,
    hashToEmail,
    fetchTasks,
  } = useDownloads();
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { accounts } = useAccounts();
  const { startDownload } = useDownloadAction();

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [latestApp, setLatestApp] = useState<Software | null>(null);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [checkingSigning, setCheckingSigning] = useState(false);

  const task = tasks.find((t) => t.id === id);

  if (!task) {
    return (
      <PageContainer title={t("downloads.package.title")}>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {tasks.length === 0 ? t("loading") : t("downloads.package.notFound")}
        </div>
      </PageContainer>
    );
  }

  const isActive = task.status === "downloading" || task.status === "injecting";
  const isPaused = task.status === "paused";
  const isCompleted = task.status === "completed";
  const isLocalUpload = task.accountHash === LOCAL_UPLOAD_ACCOUNT_HASH;
  const installInfo = isCompleted ? getInstallInfo(task.id) : null;

  const accountEmail = isLocalUpload
    ? t("downloads.upload.localSource")
    : hashToEmail[task.accountHash];
  const account = accounts.find((a) => a.email === accountEmail);
  const ctx = isLocalUpload
    ? {
        userName: t("downloads.upload.localSource"),
        appleId: "-",
        country: "-",
      }
    : getAccountContext(account, t);
  const appName = task.software.name;

  function toastAction(titleKey: string, type: "success" | "info" = "info") {
    addToast(t("toast.msg", { appName, ...ctx }), type, t(titleKey));
  }

  async function handleDelete() {
    if (!confirm(t("downloads.package.deleteConfirm"))) return;
    await deleteDownload(task!.id);
    toastAction("toast.title.deleteSuccess", "success");
    navigate("/downloads");
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    if (!installInfo) return;

    const urlToShare = installInfo.installUrl;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(urlToShare);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = urlToShare;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.warn("Clipboard fallback failed:", err);
    }

    addToast(
      t("toast.msgShare", { appName, ...ctx }),
      "success",
      t("toast.title.shareAcquired"),
    );

    if (navigator.share) {
      try {
        await navigator.share({ text: urlToShare });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        console.warn("Native share failed or aborted by user:", error);
      }
    }
  }

  async function handleCheckUpdate() {
    if (!task || !account) return;
    setCheckingUpdate(true);
    try {
      const country = storeIdToCountry(account.store) ?? "US";
      const app = await lookupApp(task.software.bundleID, country);

      if (app && isNewerVersion(app.version, task.software.version)) {
        setLatestApp(app);
        const result = await listVersions(account, app);
        setAvailableVersions(result.versions);
        setSelectedVersion(result.versions[0] || "");
        setShowUpdateModal(true);
      } else {
        addToast(t("downloads.package.noUpdate"), "info");
      }
    } catch {
      addToast(t("downloads.package.checkUpdateFailed"), "error");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleConfirmUpdate() {
    if (!task || !account || !latestApp) return;
    setShowUpdateModal(false);
    try {
      const isLatest =
        availableVersions.length > 0 &&
        selectedVersion === availableVersions[0];
      await startDownload(
        account,
        latestApp,
        isLatest ? undefined : selectedVersion,
      );
      await deleteDownload(task.id);
      navigate("/downloads");
    } catch {
      addToast(t("downloads.package.updateFailed"), "error");
    }
  }

  async function handleAnalyzeSigning() {
    if (!task || checkingSigning) return;
    setCheckingSigning(true);
    try {
      await analyzeDownloadSigning(task.id, task.accountHash);
      await fetchTasks();
      addToast(t("downloads.signing.checkSuccess"), "success");
    } catch {
      addToast(t("downloads.signing.checkFailed"), "error");
    } finally {
      setCheckingSigning(false);
    }
  }

  return (
    <PageContainer title={t("downloads.package.title")}>
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <AppIcon
            url={task.software.artworkUrl}
            name={task.software.name}
            size="lg"
          />
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {task.software.name}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {task.software.artistName}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Badge status={task.status} />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                v{task.software.version}
              </span>
            </div>
          </div>
        </div>

        {(isActive || isPaused) && (
          <div>
            <ProgressBar progress={task.progress} />
            <div className="flex justify-between mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{Math.round(task.progress)}%</span>
              {task.speed && isActive && <span>{task.speed}</span>}
            </div>
          </div>
        )}

        {task.error && (
          <p className="text-sm text-red-500 dark:text-red-400">{task.error}</p>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.bundleId")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200 min-w-0 truncate ml-4">
                {task.software.bundleID}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.version")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200">
                {task.software.version}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.account")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200 min-w-0 truncate ml-4">
                {accountEmail || task.accountHash}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.created")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200">
                {new Date(task.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        {task.signingInfo && (
          <SigningInfoPanel signingInfo={task.signingInfo} />
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {isCompleted && (
              <>
                {!isLocalUpload && (
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    {checkingUpdate
                      ? t("downloads.package.checkingUpdate")
                      : t("downloads.package.checkUpdate")}
                  </button>
                )}
                <button
                  onClick={handleAnalyzeSigning}
                  disabled={checkingSigning}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {checkingSigning
                    ? t("downloads.signing.checking")
                    : t("downloads.signing.check")}
                </button>
                {installInfo && (
                  <>
                    <a
                      href={installInfo.installUrl}
                      onClick={() => toastAction("toast.title.installStarted")}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                      {t("downloads.package.install")}
                    </a>

                    <div className="relative group flex items-center">
                      <button
                        onClick={handleShare}
                        className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                      >
                        {t("downloads.package.share")}
                      </button>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 z-50 pointer-events-none">
                        <div className="bg-white p-2 rounded-lg shadow-xl border border-gray-200 flex flex-col items-center">
                          <QRCodeSVG
                            value={installInfo.installUrl}
                            size={128}
                            className="mb-1"
                          />
                          <span className="text-xs text-gray-500 mt-1 whitespace-nowrap">
                            {t("downloads.package.scan")}
                          </span>
                          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-200 transform rotate-45"></div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <button
                  onClick={async () => {
                    toastAction("toast.title.downloadIpaStarted");
                    try {
                      const res = await fetch(
                        `/api/packages/${task.id}/file?accountHash=${encodeURIComponent(task.accountHash)}`,
                        { headers: authHeaders() },
                      );
                      if (!res.ok) throw new Error("Download failed");
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${task.software.name}_${task.software.version}.ipa`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch {
                      addToast(t("downloads.package.downloadFailed"), "error");
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {t("downloads.package.downloadIpa")}
                </button>
              </>
            )}
            {isActive && (
              <button
                onClick={() => pauseDownload(task.id)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t("downloads.package.pause")}
              </button>
            )}
            {isPaused && (
              <button
                onClick={() => resumeDownload(task.id)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t("downloads.package.resume")}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              {t("downloads.package.delete")}
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        title={t("downloads.package.updateAvailable")}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("downloads.package.updatePrompt", {
              version: latestApp?.version,
            })}
          </p>
          {availableVersions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("downloads.package.selectVersion")}
              </label>
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-white"
              >
                {availableVersions.map((v, i) => (
                  <option key={v} value={v}>
                    {i === 0
                      ? t("downloads.package.latestVersion", { id: v })
                      : v}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowUpdateModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t("settings.data.cancel")}
            </button>
            <button
              onClick={handleConfirmUpdate}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("downloads.package.update")}
            </button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

function SigningInfoPanel({
  signingInfo,
}: {
  signingInfo: IpaSigningInfo;
}) {
  const { t } = useTranslation();
  const statusClass = signingInfo.likelyOtaInstallable
    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
    : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("downloads.signing.title")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t("downloads.signing.profileType", {
              type: t(`downloads.signing.types.${signingInfo.profileType}`),
            })}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${statusClass}`}
        >
          {signingInfo.likelyOtaInstallable
            ? t("downloads.signing.otaLikely")
            : t("downloads.signing.otaRisk")}
        </span>
      </div>

      {signingInfo.warnings.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <ul className="space-y-1">
            {signingInfo.warnings.map((warning) => (
              <li key={warning}>
                {t(`downloads.signing.warnings.${warning}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <InfoItem label={t("downloads.signing.hasProfile")}>
          {signingInfo.hasEmbeddedProvision
            ? t("downloads.signing.yes")
            : t("downloads.signing.no")}
        </InfoItem>
        <InfoItem label={t("downloads.signing.hasSignature")}>
          {signingInfo.hasCodeSignature
            ? t("downloads.signing.yes")
            : t("downloads.signing.no")}
        </InfoItem>
        <InfoItem label={t("downloads.signing.team")}>
          {signingInfo.teamName ||
            signingInfo.teamIdentifiers.join(", ") ||
            "-"}
        </InfoItem>
        <InfoItem label={t("downloads.signing.profileName")}>
          {signingInfo.profileName || "-"}
        </InfoItem>
        <InfoItem label={t("downloads.signing.bundleId")}>
          {signingInfo.provisionBundleID || "-"}
        </InfoItem>
        <InfoItem label={t("downloads.signing.expires")}>
          {formatDate(signingInfo.expiresAt)}
        </InfoItem>
      </dl>

      {signingInfo.certificates.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
            {t("downloads.signing.certificates")}
          </p>
          <div className="space-y-2">
            {signingInfo.certificates.map((cert) => (
              <div
                key={cert.fingerprint256}
                className="rounded-md bg-gray-50 p-3 text-xs dark:bg-gray-800/60"
              >
                <p className="font-medium text-gray-900 dark:text-white">
                  {certLabel(cert.subject)}
                </p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">
                  {formatDate(cert.validFrom)} - {formatDate(cert.validTo)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 truncate text-gray-900 dark:text-gray-200">
        {children}
      </dd>
    </div>
  );
}
