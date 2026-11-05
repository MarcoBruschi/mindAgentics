/**
 * Accounts and Provider Credentials Models
 * Accounts and credentials configuration schema.
 */

export type AccountProvider = 'anthropic' | 'openai' | 'github' | 'gemini' | 'ollama' | 'custom';

export interface AccountDescriptor {
  id: string;
  provider: AccountProvider;
  name: string; // e.g. "Work", "Default", "Personal"
  isActive: boolean;
  isDefault?: boolean;
  organizationId?: string;
  environment?: 'local' | 'remote';
  lastVerifiedAt?: string;
  createdAt: string;
}

export interface EncryptedAccountRecord extends AccountDescriptor {
  encryptedKey: string;
  iv: string;
  authTag: string;
}

export interface KeystoreDocument {
  version: 1;
  accounts: EncryptedAccountRecord[];
}
