import type { MonitorOption } from '@/types/lidarr';

export type Settings = {
  baseUrl: string;
  apiKey: string;
  qualityProfileId: number | null;
  metadataProfileId: number | null;
  rootFolderPath: string | null;
  monitor: MonitorOption;
  searchOnAdd: boolean;
};

const DEFAULTS: Settings = {
  baseUrl: '',
  apiKey: '',
  qualityProfileId: null,
  metadataProfileId: null,
  rootFolderPath: null,
  monitor: 'all',
  searchOnAdd: true,
};

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (got[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  next.baseUrl = normalizeBaseUrl(next.baseUrl);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function normalizeBaseUrl(input: string): string {
  return (input ?? '').trim().replace(/\/+$/, '');
}

export function hasCredentials(s: Settings): boolean {
  return Boolean(s.baseUrl && s.apiKey);
}

export function isFullyConfigured(s: Settings): boolean {
  return (
    hasCredentials(s) &&
    s.qualityProfileId !== null &&
    s.metadataProfileId !== null &&
    s.rootFolderPath !== null
  );
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'sync' || !changes[SETTINGS_KEY]) return;
    const next = { ...DEFAULTS, ...(changes[SETTINGS_KEY].newValue ?? {}) };
    cb(next as Settings);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

const PROFILES_CACHE_KEY = 'profilesCache';

export type CachedProfiles<T> = { value: T; cachedAt: number };

export async function getCache<T>(key: string): Promise<CachedProfiles<T> | null> {
  const got = await chrome.storage.local.get(key);
  return (got[key] ?? null) as CachedProfiles<T> | null;
}

export async function setCache<T>(key: string, value: T): Promise<void> {
  const entry: CachedProfiles<T> = { value, cachedAt: Date.now() };
  await chrome.storage.local.set({ [key]: entry });
}

export const ProfilesCacheKey = PROFILES_CACHE_KEY;

export type RecentAdd = {
  kind: 'artist' | 'album';
  title: string;
  artistName?: string;
  mbid: string;
  lidarrUrl?: string;
  mbUrl?: string;
  addedAt: number;
};

const RECENT_ADDS_KEY = 'recentAdds';
const RECENT_ADDS_LIMIT = 10;

export async function getRecentAdds(): Promise<RecentAdd[]> {
  const got = await chrome.storage.local.get(RECENT_ADDS_KEY);
  return (got[RECENT_ADDS_KEY] ?? []) as RecentAdd[];
}

export async function pushRecentAdd(entry: RecentAdd): Promise<void> {
  const list = await getRecentAdds();
  const filtered = list.filter(
    (it) => !(it.mbid === entry.mbid && it.kind === entry.kind),
  );
  filtered.unshift(entry);
  if (filtered.length > RECENT_ADDS_LIMIT) filtered.length = RECENT_ADDS_LIMIT;
  await chrome.storage.local.set({ [RECENT_ADDS_KEY]: filtered });
}
