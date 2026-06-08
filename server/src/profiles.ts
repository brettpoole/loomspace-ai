/**
 * Profile management with encrypted API key storage.
 *
 * Keys are encrypted at rest using AES-256-GCM derived from a server secret
 * (DATA_SECRET env var). The profile file stores non-sensitive metadata and
 * generation params; each key lives in a separate file keyed by profile id.
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIProvider = 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible-custom';

export interface GenerationParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stop?: string[];
}

export interface Profile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
  /** true when an encrypted key is stored on disk */
  hasKey: boolean;
}

export interface SettingsSnapshot {
  activeProviderConfigId: string;
  providerConfigs: Profile[];
}

export interface SaveSettingsSnapshotInput {
  activeProviderConfigId: string;
  providerConfigs: Array<Omit<Profile, 'hasKey'>>;
}

interface StoredProfile {
  id: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
}

interface StoredSettings {
  activeProviderConfigId: string;
}

interface EncryptedKey {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');
const KEYS_DIR = join(DATA_DIR, 'keys');

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(KEYS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function serverSecret(): string {
  const secret = process.env.DATA_SECRET;
  if (!secret) throw new Error('DATA_SECRET env var is required');
  return secret;
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

function sanitizeGenerationParams(raw: unknown): GenerationParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const params: GenerationParams = {};
  const numericKeys: Array<Exclude<keyof GenerationParams, 'stop'>> = [
    'temperature',
    'topP',
    'topK',
    'maxTokens',
    'frequencyPenalty',
    'presencePenalty',
    'seed',
  ];

  for (const key of numericKeys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      params[key] = value;
    }
  }

  if (Array.isArray(record.stop)) {
    const stop = record.stop.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    if (stop.length > 0) params.stop = stop;
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function normalizeStoredProfile(raw: Partial<StoredProfile>): StoredProfile | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.kind !== 'openai' && raw.kind !== 'anthropic' && raw.kind !== 'openrouter' && raw.kind !== 'openai-compatible-custom') return null;
  return {
    id: raw.id,
    kind: raw.kind,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : 'Untitled profile',
    model: typeof raw.model === 'string' ? raw.model : '',
    ...(typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? { baseUrl: raw.baseUrl.trim() } : {}),
    ...(sanitizeGenerationParams(raw.params) ? { params: sanitizeGenerationParams(raw.params) } : {}),
  };
}

function readProfiles(): StoredProfile[] {
  ensureDirs();
  if (!existsSync(PROFILES_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(PROFILES_FILE, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeStoredProfile((entry ?? {}) as Partial<StoredProfile>))
      .filter((entry): entry is StoredProfile => entry !== null);
  } catch {
    return [];
  }
}

function writeProfiles(profiles: StoredProfile[]) {
  ensureDirs();
  writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
}

function readStoredSettings(): StoredSettings | null {
  ensureDirs();
  if (!existsSync(SETTINGS_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Partial<StoredSettings>;
    if (!parsed || typeof parsed.activeProviderConfigId !== 'string') return null;
    return { activeProviderConfigId: parsed.activeProviderConfigId };
  } catch {
    return null;
  }
}

function writeStoredSettings(settings: StoredSettings) {
  ensureDirs();
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function keyPath(id: string) {
  return join(KEYS_DIR, `${id}.json`);
}

function readEncryptedKey(id: string): EncryptedKey | null {
  const path = keyPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EncryptedKey;
  } catch {
    return null;
  }
}

function writeEncryptedKey(id: string, payload: EncryptedKey) {
  ensureDirs();
  writeFileSync(keyPath(id), JSON.stringify(payload), 'utf8');
}

function deleteEncryptedKey(id: string) {
  const path = keyPath(id);
  if (existsSync(path)) rmSync(path);
}

function profileHasKey(id: string) {
  return existsSync(keyPath(id));
}

function toPublicProfile(profile: StoredProfile): Profile {
  return {
    ...profile,
    hasKey: profileHasKey(profile.id),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all profiles. Never includes decrypted keys. */
export function listProfiles(): Profile[] {
  return readProfiles().map(toPublicProfile);
}

/** Get a single profile. Returns null when not found. */
export function getProfile(id: string): Profile | null {
  const profile = readProfiles().find((entry) => entry.id === id);
  return profile ? toPublicProfile(profile) : null;
}

export interface UpsertProfileInput {
  id?: string;
  kind: AIProvider;
  label: string;
  model: string;
  baseUrl?: string;
  params?: GenerationParams;
  /** If provided, encrypt and store this API key on disk. */
  apiKey?: string;
}

/** Create or update a profile. Returns the resulting Profile. */
export function upsertProfile(input: UpsertProfileInput): Profile {
  const profiles = readProfiles();
  const id = input.id ?? crypto.randomUUID();
  const existingIndex = profiles.findIndex((profile) => profile.id === id);
  const params = sanitizeGenerationParams(input.params);
  const stored: StoredProfile = {
    id,
    kind: input.kind,
    label: input.label,
    model: input.model,
    ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
    ...(params ? { params } : {}),
  };

  if (existingIndex === -1) profiles.push(stored);
  else profiles[existingIndex] = stored;
  writeProfiles(profiles);

  const currentSettings = readStoredSettings();
  if (!currentSettings || !currentSettings.activeProviderConfigId) {
    writeStoredSettings({ activeProviderConfigId: id });
  }

  if (input.apiKey !== undefined && input.apiKey !== '') {
    writeEncryptedKey(id, encryptKey(input.apiKey));
  }

  return toPublicProfile(stored);
}

/** Persist the full provider-settings snapshot without exposing decrypted keys. */
export function saveSettingsSnapshot(input: SaveSettingsSnapshotInput): SettingsSnapshot {
  const nextProfiles = input.providerConfigs.map((profile) => {
    const params = sanitizeGenerationParams(profile.params);
    return {
      id: profile.id,
      kind: profile.kind,
      label: profile.label,
      model: profile.model,
      ...(profile.baseUrl?.trim() ? { baseUrl: profile.baseUrl.trim() } : {}),
      ...(params ? { params } : {}),
    } satisfies StoredProfile;
  });

  writeProfiles(nextProfiles);

  const validIds = new Set(nextProfiles.map((profile) => profile.id));
  for (const keyId of orphanedKeyIds()) {
    if (!validIds.has(keyId)) deleteEncryptedKey(keyId);
  }

  const activeProviderConfigId = validIds.has(input.activeProviderConfigId)
    ? input.activeProviderConfigId
    : nextProfiles[0]?.id ?? '';
  writeStoredSettings({ activeProviderConfigId });

  return {
    activeProviderConfigId,
    providerConfigs: nextProfiles.map(toPublicProfile),
  };
}

/** Load the full provider-settings snapshot. Returns null when nothing is stored yet. */
export function loadSettingsSnapshot(): SettingsSnapshot | null {
  const providerConfigs = listProfiles();
  const storedSettings = readStoredSettings();
  if (providerConfigs.length === 0 && !storedSettings?.activeProviderConfigId) return null;
  return {
    activeProviderConfigId: providerConfigs.some((profile) => profile.id === storedSettings?.activeProviderConfigId)
      ? storedSettings?.activeProviderConfigId ?? providerConfigs[0]?.id ?? ''
      : providerConfigs[0]?.id ?? '',
    providerConfigs,
  };
}

/** Delete a profile and its stored key. */
export function deleteProfile(id: string): boolean {
  const profiles = readProfiles();
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  if (nextProfiles.length === profiles.length) return false;
  writeProfiles(nextProfiles);
  deleteEncryptedKey(id);

  const storedSettings = readStoredSettings();
  if (storedSettings?.activeProviderConfigId === id) {
    writeStoredSettings({ activeProviderConfigId: nextProfiles[0]?.id ?? '' });
  }

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

/** Retrieve the decrypted API key for a profile. Throws when no key is stored. */
export function resolveKey(id: string): string {
  const payload = readEncryptedKey(id);
  if (!payload) throw new Error(`No API key stored for profile ${id}`);
  return decryptKey(payload);
}

/** Return stored key ids to keep the data directory consistent on startup. */
export function orphanedKeyIds(): string[] {
  ensureDirs();
  const profileIds = new Set(readProfiles().map((profile) => profile.id));
  return readdirSync(KEYS_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.replace(/\.json$/, ''))
    .filter((id) => !profileIds.has(id));
}
