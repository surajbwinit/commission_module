import { create } from 'zustand';

interface Persona {
  id: string;
  name: string;
  role: string;
  roleId: string;
}

interface AppState {
  currentPersona: Persona;
  setPersona: (p: Persona) => void;

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
  currentPersona: { id: 'admin', name: 'Admin', role: 'Administrator', roleId: 'role-nsm' },
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
