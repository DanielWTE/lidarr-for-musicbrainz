import type {
  QualityProfile,
  MetadataProfile,
  RootFolder,
} from './lidarr';
import type { RecentAdd } from '@/lib/storage';

export type MbEntityKind = 'artist' | 'release-group' | 'release';

export type AddStatus =
  | 'added'
  | 'exists'
  | 'not-in-lidarr-metadata';

export type Message =
  | { type: 'TEST_CONNECTION' }
  | { type: 'FETCH_PROFILES'; force?: boolean }
  | { type: 'ADD_FROM_MB'; kind: MbEntityKind; mbid: string }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'GET_RECENT_ADDS' }
  | { type: 'CHECK_EXISTS'; kind: MbEntityKind; mbid: string };

export type Response<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string };

export type TestConnectionResult = {
  version: string;
  instanceName?: string;
};

export type FetchProfilesResult = {
  qualityProfiles: QualityProfile[];
  metadataProfiles: MetadataProfile[];
  rootFolders: RootFolder[];
  cachedAt: number;
};

export type AddFromMbResult = {
  status: AddStatus;
  kind: 'artist' | 'album';
  lidarrUrl?: string;
  title?: string;
};

export type GetRecentAddsResult = {
  items: RecentAdd[];
};

export type CheckExistsResult = {
  exists: boolean;
  kind: 'artist' | 'album';
  title?: string;
  lidarrUrl?: string;
};

// ── Bulk-add over chrome.runtime.connect ──────────────────────────────────
export const BATCH_PORT_NAME = 'lfmb-batch';

export type BatchItem = { kind: 'release-group' | 'release'; mbid: string };

export type BatchItemStatus = 'added' | 'exists' | 'not-in-metadata' | 'error';

export type BatchItemResult = {
  status: BatchItemStatus;
  mbid: string;
  title?: string;
  lidarrUrl?: string;
  error?: string;
};

export type BatchClientMessage =
  | { type: 'BATCH_START'; items: BatchItem[] };

export type BatchServerMessage =
  | { type: 'BATCH_PROGRESS'; index: number; total: number; result: BatchItemResult }
  | { type: 'BATCH_DONE'; total: number }
  | { type: 'BATCH_ERROR'; error: string };
