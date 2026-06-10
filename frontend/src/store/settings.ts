import { create } from "zustand";
import { persist } from "zustand/middleware";

type ThemeType = "light" | "dark" | "system";
export type EntityType = "iPhone" | "iPad" | "macSoftware";

function readLegacyCountry() {
  if (typeof localStorage === "undefined") return "US";
  return localStorage.getItem("asspp-default-country") || "US";
}

function normalizeEntity(value: string | null): EntityType {
  switch (value) {
    case "software":
    case "iPhone":
      return "iPhone";
    case "iPadSoftware":
    case "iPad":
      return "iPad";
    case "macSoftware":
      return "macSoftware";
    default:
      return "iPhone";
  }
}

function readLegacyEntity() {
  if (typeof localStorage === "undefined") return "iPhone";
  return normalizeEntity(localStorage.getItem("asspp-default-entity"));
}

interface SettingsState {
  defaultCountry: string;
  defaultEntity: EntityType;
  theme: ThemeType;
  setDefaultCountry: (country: string) => void;
  setDefaultEntity: (entity: EntityType) => void;
  setTheme: (theme: ThemeType) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      defaultCountry: readLegacyCountry(),
      defaultEntity: readLegacyEntity(),
      theme: "system",
      setDefaultCountry: (country) => set({ defaultCountry: country }),
      setDefaultEntity: (entity) => set({ defaultEntity: entity }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "asspp-settings",
    },
  ),
);
