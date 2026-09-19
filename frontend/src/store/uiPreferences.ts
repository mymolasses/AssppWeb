import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiPreferencesState {
  selectedAccountEmail: string;
  setSelectedAccountEmail: (email: string) => void;
  downloadsViewMode: "compact" | "detailed";
  setDownloadsViewMode: (mode: "compact" | "detailed") => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      selectedAccountEmail: "",
      setSelectedAccountEmail: (email) => set({ selectedAccountEmail: email }),
      downloadsViewMode: "detailed",
      setDownloadsViewMode: (mode) => set({ downloadsViewMode: mode }),
    }),
    {
      name: "asspp-ui-preferences",
    },
  ),
);
