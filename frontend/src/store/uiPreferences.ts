import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiPreferencesState {
  selectedAccountEmail: string;
  setSelectedAccountEmail: (email: string) => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      selectedAccountEmail: "",
      setSelectedAccountEmail: (email) => set({ selectedAccountEmail: email }),
    }),
    {
      name: "asspp-ui-preferences",
    },
  ),
);
