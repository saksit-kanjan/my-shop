import type { Catalog } from '@my-shop/contracts';
import { create } from 'zustand';
import { api } from '../api';

interface CatalogState {
  catalog: Catalog | null;
  load: () => Promise<void>;
}

export const useCatalog = create<CatalogState>((set) => ({
  catalog: null,
  load: async () => set({ catalog: await api.getCatalog() }),
}));
