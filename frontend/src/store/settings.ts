import { create } from "zustand";
import { persist } from "zustand/middleware";

type ThemeType = "light" | "dark" | "system";
type EntityType = "iPhone" | "iPad" | "macSoftware";

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
      defaultCountry: "US",
      defaultEntity: "iPhone",
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
