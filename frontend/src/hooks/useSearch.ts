import { create } from "zustand";
import type { Software } from "../types";
import { searchApps, lookupApp } from "../api/search";

interface SearchState {
  term: string;
  country: string;
  entity: string;
  results: Software[];
  loading: boolean;
  error: string | null;
  // 用于更新搜索框和选项的状态
  setSearchParam: (param: Partial<Pick<SearchState, "term" | "country" | "entity">>) => void;
  search: (term: string, country: string, entity: string) => Promise<void>;
  lookup: (bundleId: string, country: string) => Promise<void>;
}

export const useSearch = create<SearchState>((set) => ({
  term: "",
  country: "",
  entity: "",
  results: [],
  loading: false,
  error: null,
  setSearchParam: (param) => set((state) => ({ ...state, ...param })),
  search: async (term, country, entity) => {
    // 发起搜索时，同步保存当前的搜索条件和 loading 状态
    set({ loading: true, error: null, term, country, entity });
    try {
      const apps = await searchApps(term, country, entity);
      set({ results: apps });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Search failed", results: [] });
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
      set({ error: e instanceof Error ? e.message : "Lookup failed", results: [] });
    } finally {
      set({ loading: false });
    }
  },
}));