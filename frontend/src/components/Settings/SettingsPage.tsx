import { useState, useEffect } from "react";
import PageContainer from "../Layout/PageContainer";
import { countryCodeMap } from "../../apple/config";

interface ServerInfo {
  version?: string;
  uptime?: number;
  dataDir?: string;
}

const countryNames: Record<string, string> = {
  AE: "United Arab Emirates",
  AG: "Antigua and Barbuda",
  AI: "Anguilla",
  AL: "Albania",
  AM: "Armenia",
  AO: "Angola",
  AR: "Argentina",
  AT: "Austria",
  AU: "Australia",
  AZ: "Azerbaijan",
  BB: "Barbados",
  BD: "Bangladesh",
  BE: "Belgium",
  BG: "Bulgaria",
  BH: "Bahrain",
  BM: "Bermuda",
  BN: "Brunei",
  BO: "Bolivia",
  BR: "Brazil",
  BS: "Bahamas",
  BW: "Botswana",
  BY: "Belarus",
  BZ: "Belize",
  CA: "Canada",
  CH: "Switzerland",
  CI: "Côte d'Ivoire",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CY: "Cyprus",
  CZ: "Czech Republic",
  DE: "Germany",
  DK: "Denmark",
  DM: "Dominica",
  DO: "Dominican Republic",
  DZ: "Algeria",
  EC: "Ecuador",
  EE: "Estonia",
  EG: "Egypt",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GD: "Grenada",
  GE: "Georgia",
  GH: "Ghana",
  GR: "Greece",
  GT: "Guatemala",
  GY: "Guyana",
  HK: "Hong Kong",
  HN: "Honduras",
  HR: "Croatia",
  HU: "Hungary",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IN: "India",
  IS: "Iceland",
  IT: "Italy",
  IQ: "Iraq",
  JM: "Jamaica",
  JO: "Jordan",
  JP: "Japan",
  KE: "Kenya",
  KN: "St. Kitts and Nevis",
  KR: "South Korea",
  KW: "Kuwait",
  KY: "Cayman Islands",
  KZ: "Kazakhstan",
  LB: "Lebanon",
  LC: "St. Lucia",
  LI: "Liechtenstein",
  LK: "Sri Lanka",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  MD: "Moldova",
  MG: "Madagascar",
  MK: "North Macedonia",
  ML: "Mali",
  MN: "Mongolia",
  MO: "Macau",
  MS: "Montserrat",
  MT: "Malta",
  MU: "Mauritius",
  MV: "Maldives",
  MX: "Mexico",
  MY: "Malaysia",
  NE: "Niger",
  NG: "Nigeria",
  NI: "Nicaragua",
  NL: "Netherlands",
  NO: "Norway",
  NP: "Nepal",
  NZ: "New Zealand",
  OM: "Oman",
  PA: "Panama",
  PE: "Peru",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PT: "Portugal",
  PY: "Paraguay",
  QA: "Qatar",
  RO: "Romania",
  RS: "Serbia",
  RU: "Russia",
  SA: "Saudi Arabia",
  SE: "Sweden",
  SG: "Singapore",
  SI: "Slovenia",
  SK: "Slovakia",
  SN: "Senegal",
  SR: "Suriname",
  SV: "El Salvador",
  TC: "Turks and Caicos",
  TH: "Thailand",
  TN: "Tunisia",
  TR: "Turkey",
  TT: "Trinidad and Tobago",
  TW: "Taiwan",
  TZ: "Tanzania",
  UA: "Ukraine",
  UG: "Uganda",
  US: "United States",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VC: "St. Vincent and the Grenadines",
  VE: "Venezuela",
  VG: "British Virgin Islands",
  VN: "Vietnam",
  YE: "Yemen",
  ZA: "South Africa",
};

const entityTypes = [
  { value: "software", label: "iPhone" },
  { value: "iPadSoftware", label: "iPad" },
];

function getCountryLabel(code: string): string {
  return countryNames[code] || code;
}

export default function SettingsPage() {
  const [country, setCountry] = useState(
    () => localStorage.getItem("asspp-default-country") || "US",
  );
  const [entity, setEntity] = useState(
    () => localStorage.getItem("asspp-default-entity") || "software",
  );
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    localStorage.setItem("asspp-default-country", country);
  }, [country]);

  useEffect(() => {
    localStorage.setItem("asspp-default-entity", entity);
  }, [entity]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(setServerInfo)
      .catch(() => setServerInfo(null));
  }, []);

  const sortedCountries = Object.keys(countryCodeMap).sort((a, b) =>
    getCountryLabel(a).localeCompare(getCountryLabel(b)),
  );

  return (
    <PageContainer title="Settings">
      <div className="space-y-6">
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Defaults</h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="country"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Default Country / Region
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {sortedCountries.map((code) => (
                  <option key={code} value={code}>
                    {getCountryLabel(code)} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="entity"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Default Entity Type
              </label>
              <select
                id="entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {entityTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Server</h2>
          {serverInfo ? (
            <dl className="space-y-3">
              {serverInfo.version && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Version</dt>
                  <dd className="text-sm text-gray-900">
                    {serverInfo.version}
                  </dd>
                </div>
              )}
              {serverInfo.dataDir && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">
                    Data Directory
                  </dt>
                  <dd className="text-sm text-gray-900 font-mono">
                    {serverInfo.dataDir}
                  </dd>
                </div>
              )}
              {serverInfo.uptime != null && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Uptime</dt>
                  <dd className="text-sm text-gray-900">
                    {formatUptime(serverInfo.uptime)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-500">
              Unable to connect to server.
            </p>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Data</h2>
          <p className="text-sm text-gray-600 mb-4">
            Clear all local data including accounts, credentials, and settings
            stored in this browser.
          </p>
          <button
            onClick={() => {
              if (
                !confirm(
                  "This will delete all accounts, credentials, and settings. This cannot be undone. Continue?",
                )
              )
                return;
              localStorage.clear();
              indexedDB.deleteDatabase("asspp-accounts");
              window.location.href = "/";
            }}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
          >
            Reset All Data
          </button>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">About</h2>
          <p className="text-sm text-gray-600">
            Asspp Web -- a web-based interface for managing Apple app downloads
            and licenses.
          </p>
          <p className="mt-2 text-xs text-gray-400">v0.0.1</p>
        </section>
      </div>
    </PageContainer>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
