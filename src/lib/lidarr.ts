import type {
  AlbumLookupResult,
  AlbumRecord,
  ArtistLookupResult,
  ArtistRecord,
  LidarrAddAlbumPayload,
  LidarrAddArtistPayload,
  MetadataProfile,
  QualityProfile,
  RootFolder,
  SystemStatus,
} from '@/types/lidarr';
import type { Settings } from './storage';

export type LidarrCreds = Pick<Settings, 'baseUrl' | 'apiKey'>;

export class LidarrError extends Error {
  override name = 'LidarrError';
  constructor(
    message: string,
    public status: number | null,
    public bodyText?: string,
  ) {
    super(message);
  }
}

async function request<T>(
  s: LidarrCreds,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!s.baseUrl) throw new LidarrError('Lidarr base URL is not configured', null);
  if (!s.apiKey) throw new LidarrError('Lidarr API key is not configured', null);

  const url = `${s.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'X-Api-Key': s.apiKey,
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    throw new LidarrError(
      `Lidarr unreachable at ${s.baseUrl} — check that it's running and the URL is correct.`,
      null,
    );
  }

  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      throw new LidarrError('Unauthorized — check your Lidarr API key in settings.', 401, bodyText);
    }
    if (res.status === 404) {
      throw new LidarrError(`Endpoint not found: ${path}`, 404, bodyText);
    }
    throw new LidarrError(
      `Lidarr returned HTTP ${res.status}${bodyText ? `: ${truncate(bodyText, 200)}` : ''}`,
      res.status,
      bodyText,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export async function getSystemStatus(s: LidarrCreds): Promise<SystemStatus> {
  return request<SystemStatus>(s, '/api/v1/system/status');
}

export async function getQualityProfiles(s: LidarrCreds): Promise<QualityProfile[]> {
  return request<QualityProfile[]>(s, '/api/v1/qualityprofile');
}

export async function getMetadataProfiles(s: LidarrCreds): Promise<MetadataProfile[]> {
  return request<MetadataProfile[]>(s, '/api/v1/metadataprofile');
}

export async function getRootFolders(s: LidarrCreds): Promise<RootFolder[]> {
  return request<RootFolder[]>(s, '/api/v1/rootfolder');
}

export async function lookupArtist(
  s: LidarrCreds,
  mbid: string,
): Promise<ArtistLookupResult | null> {
  const term = encodeURIComponent(`lidarr:${mbid}`);
  const list = await request<ArtistLookupResult[]>(s, `/api/v1/artist/lookup?term=${term}`);
  return list[0] ?? null;
}

export async function lookupAlbum(
  s: LidarrCreds,
  mbid: string,
): Promise<AlbumLookupResult | null> {
  const term = encodeURIComponent(`lidarr:${mbid}`);
  const list = await request<AlbumLookupResult[]>(s, `/api/v1/album/lookup?term=${term}`);
  return list[0] ?? null;
}

export async function getAllArtists(s: LidarrCreds): Promise<ArtistRecord[]> {
  return request<ArtistRecord[]>(s, '/api/v1/artist');
}

export async function getAlbumsByArtist(
  s: LidarrCreds,
  artistId: number,
): Promise<AlbumRecord[]> {
  return request<AlbumRecord[]>(s, `/api/v1/album?artistId=${artistId}`);
}

export async function findExistingArtist(
  s: LidarrCreds,
  mbid: string,
): Promise<ArtistRecord | null> {
  // Fetch the full library and match client-side. Lidarr's `?mbId=` filter is
  // version-dependent and case-sensitive on some builds, so a single source of
  // truth (filter client-side, case-insensitive) is more reliable.
  const list = await getAllArtists(s);
  const target = mbid.toLowerCase();
  const match = list.find((a) => a.foreignArtistId?.toLowerCase() === target) ?? null;
  console.log(
    `[lfmb] findExistingArtist mbid=${mbid} libraryCount=${list.length} match=${match ? `id=${match.id} name=${match.artistName}` : 'null'}`,
  );
  return match;
}

export async function findExistingAlbumByMbid(
  s: LidarrCreds,
  artistMbid: string,
  albumMbid: string,
): Promise<AlbumRecord | null> {
  // Lidarr's /album endpoint requires an artistId — we can't query by foreign album id directly.
  const artist = await findExistingArtist(s, artistMbid);
  if (!artist) return null;
  const albums = await getAlbumsByArtist(s, artist.id);
  const target = albumMbid.toLowerCase();
  const match = albums.find((a) => a.foreignAlbumId?.toLowerCase() === target);
  console.log(
    `[lfmb] findExistingAlbumByMbid artistId=${artist.id} albumsCount=${albums.length} target=${albumMbid} match=${match ? `id=${match.id} title=${match.title}` : 'null'}`,
  );
  if (match && !match.artist) {
    // /album?artistId= responses sometimes omit the inline artist; backfill so callers
    // can build a deep-link URL without an extra round-trip.
    match.artist = artist;
  }
  return match ?? null;
}

export async function addArtist(
  s: LidarrCreds,
  payload: LidarrAddArtistPayload,
): Promise<ArtistRecord> {
  return request<ArtistRecord>(s, '/api/v1/artist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function addAlbum(
  s: LidarrCreds,
  payload: LidarrAddAlbumPayload,
): Promise<AlbumRecord> {
  return request<AlbumRecord>(s, '/api/v1/album', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function buildAddArtistPayload(
  lookup: ArtistLookupResult,
  cfg: {
    qualityProfileId: number;
    metadataProfileId: number;
    rootFolderPath: string;
    monitor: LidarrAddArtistPayload['addOptions']['monitor'];
    searchForMissingAlbums: boolean;
  },
): LidarrAddArtistPayload {
  return {
    ...lookup,
    qualityProfileId: cfg.qualityProfileId,
    metadataProfileId: cfg.metadataProfileId,
    rootFolderPath: cfg.rootFolderPath,
    monitored: true,
    addOptions: {
      monitor: cfg.monitor,
      searchForMissingAlbums: cfg.searchForMissingAlbums,
    },
  };
}

export function buildAddAlbumPayload(
  lookup: AlbumLookupResult,
  cfg: {
    qualityProfileId: number;
    metadataProfileId: number;
    rootFolderPath: string;
    searchForNewAlbum: boolean;
  },
): LidarrAddAlbumPayload {
  return {
    ...lookup,
    monitored: true,
    artist: {
      ...lookup.artist,
      qualityProfileId: cfg.qualityProfileId,
      metadataProfileId: cfg.metadataProfileId,
      rootFolderPath: cfg.rootFolderPath,
      monitored: true,
    },
    addOptions: {
      searchForNewAlbum: cfg.searchForNewAlbum,
    },
  };
}

export function lidarrArtistUrl(baseUrl: string, foreignArtistId: string): string {
  return `${baseUrl}/artist/${foreignArtistId}`;
}
