/**
 * Profile management with encrypted API key storage.
 *
 * Keys are encrypted at rest using AES-256-GCM derived from a server secret
 * (DATA_SECRET env var).  The profile file itself only stores non-sensitive
 * metadata; each key lives in a separate file keyed by profile id.
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIProvider = 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible-custom';

export interface Profile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  /** true when an encrypted key is stored on disk */
  hasKey: boolean;
}

// Stored on disk — superset of Profile, never sent to the client
interface StoredProfile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
}

interface EncryptedKey {
  salt: string;   // hex
  iv: string;     // hex
  tag: string;    // hex
  ciphertext: string; // hex
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const KEYS_DIR = join(DATA_DIR, 'keys');

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(KEYS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function serverSecret(): string {
  const s = process.env.DATA_SECRET;
  if (!s) throw new Error('DATA_SECRET env var is required');
  return s;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return pbkdf2Sync(secret, salt, 100_000, 32, 'sha256');
}

function encryptKey(plaintext: string): EncryptedKey {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(serverSecret(), salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

function decryptKey(payload: EncryptedKey): string {
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');
  const key = deriveKey(serverSecret(), salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

function readProfiles(): StoredProfile[] {
  ensureDirs();
  if (!existsSync(PROFILES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PROFILES_FILE, 'utf8')) as StoredProfile[];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: StoredProfile[]) {
  ensureDirs();
  writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
}

function keyPath(id: string) {
  return join(KEYS_DIR, `${id}.json`);
}

function readEncryptedKey(id: string): EncryptedKey | null {
  const p = keyPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as EncryptedKey;
  } catch {
    return null;
  }
}

function writeEncryptedKey(id: string, payload: EncryptedKey) {
  ensureDirs();
  writeFileSync(keyPath(id), JSON.stringify(payload), 'utf8');
}

function deleteEncryptedKey(id: string) {
  const p = keyPath(id);
  if (existsSync(p)) rmSync(p);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all profiles.  Never includes decrypted keys. */
export function listProfiles(): Profile[] {
  return readProfiles().map((p) => ({
    ...p,
    hasKey: existsSync(keyPath(p.id)),
  }));
}

/** Get a single profile. Returns null when not found. */
export function getProfile(id: string): Profile | null {
  const profiles = readProfiles();
  const p = profiles.find((x) => x.id === id);
  if (!p) return null;
  return { ...p, hasKey: existsSync(keyPath(p.id)) };
}

export interface UpsertProfileInput {
  id?: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  /** If provided, encrypt and store this API key on disk. */
  apiKey?: string;
}

/** Create or update a profile. Returns the resulting Profile. */
export function upsertProfile(input: UpsertProfileInput): Profile {
  const profiles = readProfiles();
  const id = input.id ?? crypto.randomUUID();
  const existing = profiles.findIndex((p) => p.id === id);

  const stored: StoredProfile = {
    id,
    kind: input.kind,
    label: input.label,
    model: input.model,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
  };

  if (existing >= 0) {
    profiles[existing] = stored;
  } else {
    profiles.push(stored);
  }
  writeProfiles(profiles);

  if (input.apiKey !== undefined && input.apiKey !== '') {
    writeEncryptedKey(id, encryptKey(input.apiKey));
  }

  return { ...stored, hasKey: existsSync(keyPath(id)) };
}

/** Delete a profile and its stored key. */
export function deleteProfile(id: string): boolean {
  const profiles = readProfiles();
  const next = profiles.filter((p) => p.id !== id);
  if (next.length === profiles.length) return false;
  writeProfiles(next);
  deleteEncryptedKey(id);
  return true;
}

/** Store or replace the encrypted API key for a profile. */
export function storeKey(id: string, apiKey: string): void {
  if (!getProfile(id)) throw new Error(`Profile ${id} not found`);
  writeEncryptedKey(id, encryptKey(apiKey));
}

/** Delete just the stored key for a profile. */
export function clearKey(id: string): void {
  deleteEncryptedKey(id);
}

/**
 * Retrieve the decrypted API key for a profile.
 * Throws when no key is stored.
 */
export function resolveKey(id: string): string {
  const payload = readEncryptedKey(id);
  if (!payload) throw new Error(`No API key stored for profile ${id}`);
  return decryptKey(payload);
}

/** Return stored key ids to keep data directory consistent on startup. */
export function orphanedKeyIds(): string[] {
  ensureDirs();
  const profileIds = new Set(readProfiles().map((p) => p.id));
  return readdirSync(KEYS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => !profileIds.has(id));
}
