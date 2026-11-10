import { atom } from 'jotai';

export interface AccountProvider {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'github' | 'gemini' | 'ollama';
  apiKey: string;
  status: 'valid' | 'invalid' | 'untested';
}

export const accountsAtom = atom<AccountProvider[]>([
  { id: 'acc-1', name: 'Anthropic Claude', provider: 'anthropic', apiKey: 'sk-ant-••••••••••••••••', status: 'valid' },
  { id: 'acc-2', name: 'OpenAI GPT-4', provider: 'openai', apiKey: 'sk-proj-••••••••••••••••', status: 'valid' },
  { id: 'acc-3', name: 'GitHub Personal Access', provider: 'github', apiKey: 'ghp_••••••••••••••••', status: 'valid' },
  { id: 'acc-4', name: 'Google Gemini', provider: 'gemini', apiKey: 'AIza••••••••••••••••', status: 'valid' },
  { id: 'acc-5', name: 'Local Ollama', provider: 'ollama', apiKey: 'http://localhost:11434', status: 'valid' },
]);

export const isAccountsModalOpenAtom = atom<boolean>(false);
export const isWorkspaceSettingsModalOpenAtom = atom<boolean>(false);
export const isCreateFloorModalOpenAtom = atom<boolean>(false);
export const isFloorLandingModalOpenAtom = atom<boolean>(false);
export const isCommandPaletteOpenAtom = atom<boolean>(false);
export const isSidebarCollapsedAtom = atom<boolean>(false);
export const isSidebarOpenAtom = atom(
  (get) => !get(isSidebarCollapsedAtom),
  (get, set, update: boolean | ((prev: boolean) => boolean)) => {
    const current = !get(isSidebarCollapsedAtom);
    const next = typeof update === 'function' ? update(current) : update;
    set(isSidebarCollapsedAtom, !next);
  }
);
export const isCreateAgentModalOpenAtom = atom<boolean>(false);
export const isCreateWorkspaceModalOpenAtom = atom<boolean>(false);
export const isAgentLimitsModalOpenAtom = atom<boolean>(false);

export const isCreateGraphModalOpenAtom = atom<boolean>(false);
export const isProfileModalOpenAtom = atom<boolean>(false);
export const isOnboardingModalOpenAtom = atom<boolean>(false);
export const isToolbarCollapsedAtom = atom<boolean>(false);
