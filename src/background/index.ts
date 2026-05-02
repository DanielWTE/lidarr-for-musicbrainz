import {
  addAlbum,
  addArtist,
  buildAddAlbumPayload,
  buildAddArtistPayload,
  findExistingAlbumByMbid,
  findExistingArtist,
  getMetadataProfiles,
  getQualityProfiles,
  getRootFolders,
  getSystemStatus,
  LidarrError,
  lidarrArtistUrl,
  lookupAlbum,
  lookupArtist,
} from '@/lib/lidarr';
import { resolveReleaseToReleaseGroup } from '@/lib/musicbrainz';
import {
  getCache,
  getRecentAdds,
  getSettings,
  hasCredentials,
  isFullyConfigured,
  ProfilesCacheKey,
  pushRecentAdd,
  setCache,
  type Settings,
} from '@/lib/storage';
import type {
  AddFromMbResult,
  CheckExistsResult,
  FetchProfilesResult,
  GetRecentAddsResult,
  Message,
  Response as MsgResponse,
  TestConnectionResult,
} from '@/types/messages';

const PROFILES_TTL_MS = 60 * 60 * 1000; // 1h

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  void handle(msg)
    .then((response) => sendResponse(response))
    .catch((err: unknown) =>
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies MsgResponse<never>),
    );
  return true; // keep channel open for async sendResponse
});

async function handle(msg: Message): Promise<MsgResponse<unknown>> {
  switch (msg.type) {
    case 'TEST_CONNECTION':
      return handleTestConnection();
    case 'FETCH_PROFILES':
      return handleFetchProfiles(msg.force === true);
    case 'ADD_FROM_MB':
      return handleAddFromMb(msg.kind, msg.mbid);
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'GET_RECENT_ADDS':
      return handleGetRecentAdds();
    case 'CHECK_EXISTS':
      return handleCheckExists(msg.kind, msg.mbid);
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      return { ok: false, error: 'Unknown message type' };
    }
  }
}

async function handleTestConnection(): Promise<MsgResponse<TestConnectionResult>> {
  const s = await getSettings();
  if (!hasCredentials(s)) {
    return { ok: false, error: 'Set Lidarr URL and API key first.' };
  }
  try {
    const status = await getSystemStatus(s);
    return { ok: true, version: status.version, instanceName: status.instanceName };
  } catch (e) {
    return toErrorResponse(e);
  }
}

async function handleFetchProfiles(force: boolean): Promise<MsgResponse<FetchProfilesResult>> {
  const s = await getSettings();
  if (!hasCredentials(s)) {
    return { ok: false, error: 'Set Lidarr URL and API key first.' };
  }

  if (!force) {
    const cached = await getCache<FetchProfilesResult>(ProfilesCacheKey);
    if (cached && Date.now() - cached.cachedAt < PROFILES_TTL_MS) {
      return { ok: true, ...cached.value };
    }
  }

  try {
    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      getQualityProfiles(s),
      getMetadataProfiles(s),
      getRootFolders(s),
    ]);
    const value: FetchProfilesResult = {
      qualityProfiles,
      metadataProfiles,
      rootFolders,
      cachedAt: Date.now(),
    };
    await setCache<FetchProfilesResult>(ProfilesCacheKey, value);
    return { ok: true, ...value };
  } catch (e) {
    return toErrorResponse(e);
  }
}

async function handleAddFromMb(
  kind: 'artist' | 'release-group' | 'release',
  mbid: string,
): Promise<MsgResponse<AddFromMbResult>> {
  console.log(`[lfmb] ADD_FROM_MB kind=${kind} mbid=${mbid}`);
  const s = await getSettings();
  if (!hasCredentials(s)) {
    return { ok: false, error: 'Set Lidarr URL and API key first.' };
  }
  if (!isFullyConfigured(s)) {
    return {
      ok: false,
      error: 'Pick a quality profile, metadata profile, and root folder in settings.',
    };
  }

  try {
    if (kind === 'artist') {
      return await addFromMbArtist(s, mbid);
    }
    const rgMbid = kind === 'release' ? await resolveReleaseToReleaseGroup(mbid) : mbid;
    return await addFromMbReleaseGroup(s, rgMbid);
  } catch (e) {
    console.warn('[lfmb] handleAddFromMb error:', e);
    return toErrorResponse(e);
  }
}

async function addFromMbArtist(
  s: Settings,
  mbid: string,
): Promise<MsgResponse<AddFromMbResult>> {
  const existing = await findExistingArtist(s, mbid);
  if (existing) {
    return {
      ok: true,
      status: 'exists',
      kind: 'artist',
      title: existing.artistName,
      lidarrUrl: lidarrArtistUrl(s.baseUrl, existing.foreignArtistId),
    };
  }
  const lookup = await lookupArtist(s, mbid);
  if (!lookup) {
    notify('Not in Lidarr metadata', `MBID ${mbid} not found via Lidarr lookup.`);
    return { ok: true, status: 'not-in-lidarr-metadata', kind: 'artist' };
  }
  const payload = buildAddArtistPayload(lookup, {
    qualityProfileId: s.qualityProfileId!,
    metadataProfileId: s.metadataProfileId!,
    rootFolderPath: s.rootFolderPath!,
    monitor: s.monitor,
    searchForMissingAlbums: s.searchOnAdd,
  });
  const created = await addArtist(s, payload);
  console.log(`[lfmb] added artist id=${created?.id} mbid=${created?.foreignArtistId}`);
  const lidarrUrl = lidarrArtistUrl(s.baseUrl, created.foreignArtistId);
  await safePushRecentAdd({
    kind: 'artist',
    title: created.artistName,
    mbid: created.foreignArtistId,
    lidarrUrl,
    mbUrl: `https://musicbrainz.org/artist/${created.foreignArtistId}`,
    addedAt: Date.now(),
  });
  notify('Added to Lidarr', `Artist: ${created.artistName}`);
  return {
    ok: true,
    status: 'added',
    kind: 'artist',
    title: created.artistName,
    lidarrUrl,
  };
}

async function addFromMbReleaseGroup(
  s: Settings,
  mbid: string,
): Promise<MsgResponse<AddFromMbResult>> {
  // Lidarr's /album endpoint requires an artistId, so we need the parent artist
  // MBID from a metadata lookup before we can check for an existing record.
  const lookup = await lookupAlbum(s, mbid);
  if (!lookup) {
    notify('Not in Lidarr metadata', `MBID ${mbid} not found via Lidarr lookup.`);
    return { ok: true, status: 'not-in-lidarr-metadata', kind: 'album' };
  }
  const artistMbid = lookup.artist?.foreignArtistId;
  if (artistMbid) {
    const existing = await findExistingAlbumByMbid(s, artistMbid, mbid);
    if (existing) {
      const aMbid = existing.artist?.foreignArtistId ?? artistMbid;
      return {
        ok: true,
        status: 'exists',
        kind: 'album',
        title: existing.title,
        lidarrUrl: lidarrArtistUrl(s.baseUrl, aMbid),
      };
    }
  }
  const payload = buildAddAlbumPayload(lookup, {
    qualityProfileId: s.qualityProfileId!,
    metadataProfileId: s.metadataProfileId!,
    rootFolderPath: s.rootFolderPath!,
    searchForNewAlbum: s.searchOnAdd,
  });
  const created = await addAlbum(s, payload);
  console.log(`[lfmb] added album id=${created?.id} mbid=${created?.foreignAlbumId}`);
  const aMbid = created.artist?.foreignArtistId ?? artistMbid;
  const lidarrUrl = aMbid ? lidarrArtistUrl(s.baseUrl, aMbid) : undefined;
  await safePushRecentAdd({
    kind: 'album',
    title: created.title,
    artistName: created.artist?.artistName ?? lookup.artist?.artistName,
    mbid: created.foreignAlbumId ?? mbid,
    lidarrUrl,
    mbUrl: `https://musicbrainz.org/release-group/${created.foreignAlbumId ?? mbid}`,
    addedAt: Date.now(),
  });
  notify('Added to Lidarr', `Album: ${created.title}`);
  return {
    ok: true,
    status: 'added',
    kind: 'album',
    title: created.title,
    lidarrUrl,
  };
}

async function safePushRecentAdd(
  entry: Parameters<typeof pushRecentAdd>[0],
): Promise<void> {
  try {
    await pushRecentAdd(entry);
  } catch (e) {
    console.error('[lfmb] pushRecentAdd failed:', e);
  }
}

async function handleGetRecentAdds(): Promise<MsgResponse<GetRecentAddsResult>> {
  return { ok: true, items: await getRecentAdds() };
}

async function handleCheckExists(
  kind: 'artist' | 'release-group' | 'release',
  mbid: string,
): Promise<MsgResponse<CheckExistsResult>> {
  const s = await getSettings();
  if (!hasCredentials(s)) {
    return { ok: false, error: 'Set Lidarr URL and API key first.' };
  }
  console.log(`[lfmb] CHECK_EXISTS kind=${kind} mbid=${mbid}`);
  try {
    if (kind === 'artist') {
      const existing = await findExistingArtist(s, mbid);
      if (!existing) return { ok: true, exists: false, kind: 'artist' };
      return {
        ok: true,
        exists: true,
        kind: 'artist',
        title: existing.artistName,
        lidarrUrl: lidarrArtistUrl(s.baseUrl, existing.foreignArtistId),
      };
    }
    // For release/release-group we need the parent artist MBID. The Lidarr
    // album lookup is the cheapest way to get it without round-tripping MB.
    let rgMbid = mbid;
    if (kind === 'release') {
      rgMbid = await resolveReleaseToReleaseGroup(mbid);
    }
    const lookup = await lookupAlbum(s, rgMbid);
    if (!lookup || !lookup.artist?.foreignArtistId) {
      return { ok: true, exists: false, kind: 'album' };
    }
    const existing = await findExistingAlbumByMbid(
      s,
      lookup.artist.foreignArtistId,
      rgMbid,
    );
    if (!existing) return { ok: true, exists: false, kind: 'album' };
    const aMbid = existing.artist?.foreignArtistId ?? lookup.artist.foreignArtistId;
    return {
      ok: true,
      exists: true,
      kind: 'album',
      title: existing.title,
      lidarrUrl: lidarrArtistUrl(s.baseUrl, aMbid),
    };
  } catch (e) {
    console.warn('[lfmb] CHECK_EXISTS error:', e);
    return toErrorResponse(e);
  }
}

function toErrorResponse(e: unknown): MsgResponse<never> {
  if (e instanceof LidarrError) {
    return { ok: false, error: e.message, code: e.status ? String(e.status) : undefined };
  }
  if (e instanceof Error) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: String(e) };
}

function notify(title: string, message: string): void {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icon128.png'),
      title,
      message,
    });
  } catch {
    /* notifications are best-effort */
  }
}
