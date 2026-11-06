import type { Employee } from '@my-shop/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api';
import { storeInfo } from '../data/demo-catalog';

interface SessionState {
  employee: Employee | null;
  shiftId: string | null;
  /** Shift that was just closed, so the Z report can show it after logout. */
  closedShiftId: string | null;
  login: (code: string) => Promise<boolean>;
  restoreShift: () => Promise<boolean>;
  setShift: (id: string | null) => void;
  finishShift: (closedId: string) => void;
  logout: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      employee: null,
      shiftId: null,
      closedShiftId: null,
      login: async (code) => {
        const employee = await api.login(code, storeInfo.terminalId);
        if (!employee) return false;
        const open = await api.getOpenShift(storeInfo.terminalId);
        set({ employee, shiftId: open?.id ?? null });
        return true;
      },
      restoreShift: async () => {
        const open = await api.getOpenShift(storeInfo.terminalId);
        set({ shiftId: open?.id ?? null });
        return !!open;
      },
      setShift: (id) => set({ shiftId: id }),
      finishShift: (closedId) => set({ shiftId: null, closedShiftId: closedId }),
      logout: () => {
        void api.logout().catch(() => undefined);
        set({ employee: null, shiftId: null });
      },
    }),
    { name: 'myshop.pos.session' },
  ),
);
