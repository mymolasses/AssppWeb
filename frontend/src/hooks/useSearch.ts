import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Software } from "../types";
import { searchApps, lookupApp } from "../api/search";

interface SearchState {
  term: string;
  country: string;
  countrySource: "manual" | "default" | "";
  entity: string;
  entitySource: "manual" | "default" | "";
  results: Software[];
  loading: boolean;
  error: string | null;
  setSearchParam: (
    param: Partial<Pick<SearchState, "term" | "country" | "entity">>,
  ) => void;
  setSearchDefaults: (
    param: Partial<Pick<SearchState, "country" | "entity">>,
  ) => void;
  search: (term: string, country: string, entity: string) => Promise<void>;
  lookup: (bundleId: string, country: string) => Promise<void>;
  clear: () => void;
}

export const useSearch = create<SearchState>()(
  persist(
    (set) => ({
      term: "",
      country: "",
      countrySource: "",
      entity: "",
      entitySource: "",
      results: [],
      loading: false,
      error: null,
      setSearchParam: (param) =>
        set((state) => ({
          ...state,
          ...param,
          countrySource:
            param.country === undefined ? state.countrySource : "manual",
          entitySource:
            param.entity === undefined ? state.entitySource : "manual",
        })),
      setSearchDefaults: (param) =>
        set((state) => ({
          ...state,
          country:
            param.country !== undefined && state.countrySource !== "manual"
              ? param.country
              : state.country,
          countrySource:
            param.country !== undefined && state.countrySource !== "manual"
              ? "default"
              : state.countrySource,
          entity:
            param.entity !== undefined && state.entitySource !== "manual"
              ? param.entity
              : state.entity,
          entitySource:
            param.entity !== undefined && state.entitySource !== "manual"
              ? "default"
              : state.entitySource,
        })),
      search: async (term, country, entity) => {
        set({ loading: true, error: null, term, country, entity });
        try {
          const apps = await searchApps(term, country, entity);
          set({ results: apps });
        } catch (e) {
          set({
            error: e instanceof Error ? e.message : "Search failed",
            results: [],
          });
        } finally {
          set({ loading: false });
        }
      },
      lookup: async (bundleId, country) => {
        set({ loading: true, error: null });
        try {
          const app = await lookupApp(bundleId, country);
          set({ results: app ? [app] : [] });
        } catch (e) {
          set({
            error: e instanceof Error ? e.message : "Lookup failed",
            results: [],
          });
        } finally {
          set({ loading: false });
        }
      },
      clear: () => set({ term: "", results: [], error: null }),
    }),
    {
      name: "asspp-search-cache",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({
        term,
        country,
        countrySource,
        entity,
        entitySource,
        results,
      }) => ({
        term,
        country,
        countrySource,
        entity,
        entitySource,
        results,
        loading: false,
        error: null,
      }),
    },
  ),
);
