import { create } from 'zustand';

export interface Persona {
  uid: string;
  name: string;
  role_code: string;
  role_name: string;
}

interface AppState {
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;

  currentPersona: Persona | null;
  setPersona: (p: Persona | null) => void;

  selectedPeriod: string;
  setSelectedPeriod: (p: string) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  // Human-readable labels for dynamic route segments (e.g. /plans/<uid> -> plan
  // name). Detail pages publish theirs once loaded so the header breadcrumb can
  // show a real name instead of the raw uid.
  crumbLabels: Record<string, string>;
  setCrumbLabel: (path: string, label: string) => void;
}

// Default period shown on load — May 2026 is the month the loaded SADAFCO data covers.
// Switch back to the current month once live monthly data feeds begin.
const DEFAULT_PERIOD = '2026-05';

const AUTH_KEY = 'ciq-authenticated';

export const useAppStore = create<AppState>((set) => ({
  isAuthenticated: typeof window !== 'undefined' && window.localStorage.getItem(AUTH_KEY) === '1',
  login: () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(AUTH_KEY, '1');
    set({ isAuthenticated: true });
  },
  logout: () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_KEY);
    set({ isAuthenticated: false });
  },

  currentPersona: null,
  setPersona: (currentPersona) => set({ currentPersona }),

  selectedPeriod: DEFAULT_PERIOD,
  setSelectedPeriod: (selectedPeriod) => set({ selectedPeriod }),

  sidebarCollapsed: typeof window !== 'undefined' && window.localStorage.getItem('sidebar-collapsed') === '1',
  toggleSidebar: () => set((s) => {
    const v = !s.sidebarCollapsed;
    if (typeof window !== 'undefined') window.localStorage.setItem('sidebar-collapsed', v ? '1' : '0');
    return { sidebarCollapsed: v };
  }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  crumbLabels: {},
  setCrumbLabel: (path, label) => set((s) => (
    s.crumbLabels[path] === label ? s : { crumbLabels: { ...s.crumbLabels, [path]: label } }
  )),
}));