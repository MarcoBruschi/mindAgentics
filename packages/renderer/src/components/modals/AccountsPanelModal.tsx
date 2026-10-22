import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { isAccountsModalOpenAtom, accountsAtom, AccountProvider } from '@/atoms/ui';
import {
  X,
  Key,
  ShieldCheck,
  Eye,
  EyeOff,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

export const AccountsPanelModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isAccountsModalOpenAtom);
  const [accounts, setAccounts] = useAtom(accountsAtom);
  const [revealedIds, setRevealedIds] = useState<string[]>([]);

  if (!isOpen) return null;

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const updateApiKey = (id: string, val: string) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === id ? { ...acc, apiKey: val } : acc))
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#1d1f27] border-b border-white/5">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Accounts & API Key Store</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-zinc-300">
          <div className="text-zinc-400 leading-relaxed">
            API keys are securely stored in the local encrypted keystore (<code className="text-zinc-300 font-mono">~/.maestri/accounts/keystore.enc</code>) and injected into terminal agents.
          </div>

          <div className="space-y-3 mt-2">
            {accounts.map((acc) => {
              const isRevealed = revealedIds.includes(acc.id);

              return (
                <div
                  key={acc.id}
                  className="p-3 bg-[#111216] border border-white/5 rounded-xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{acc.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Connected</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      value={acc.apiKey}
                      onChange={(e) => updateApiKey(acc.id, e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-[#16181d] border border-white/10 rounded-lg text-white font-mono text-[11px] outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => toggleReveal(acc.id)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-white/5"
                      title={isRevealed ? 'Hide API key' : 'Show API key'}
                    >
                      {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-white/5">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
