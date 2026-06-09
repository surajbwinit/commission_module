import { create } from 'zustand';

export interface Persona {
  uid: string;
  name: string;
  role_code: string;
  role_name: string;
}

interface AppState {
  currentPersona: Persona | null;
  setPersona: (p: Persona | null) => void;

  selectedPeriod: string;
  setSelectedPeriod: (p: string) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
}

const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const useAppStore = create<AppState>((set) => ({
  currentPersona: null,
  setPersona: (currentPersona) => set({ currentPersona }),

  selectedPeriod: currentPeriod(),
  setSelectedPeriod: (selectedPeriod) => set({ selectedPeriod }),

  sidebarCollapsed: typeof window !== 'undefined' && window.localStorage.getItem('sidebar-collapsed') === '1',
  toggleSidebar: () => set((s) => {
    const v = !s.sidebarCollapsed;
    if (typeof window !== 'undefined') window.localStorage.setItem('sidebar-collapsed', v ? '1' : '0');
    return { sidebarCollapsed: v };
  }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
}));
