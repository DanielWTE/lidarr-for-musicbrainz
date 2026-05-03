import {
  addAlbum,
  addArtist,
  buildAddAlbumPayload,
  buildAddArtistPayload,
  findExistingAlbumByMbid,
  findExistingArtist,
  getAlbumsByArtist,
  getAllArtists,
  getMetadataProfiles,
  getQualityProfiles,
  getRootFolders,
  getSystemStatus,
  LidarrError,
  lidarrArtistUrl,
  lookupAlbum,
  lookupArtist,
} from '@/lib/lidarr';
import type { AlbumRecord, ArtistRecord } from '@/types/lidarr';
import { detectPage, resolveReleaseToReleaseGroup } from '@/lib/musicbrainz';
import {
  type Activity,
  type ActivityStatus,
  getCache,
  getRecentAdds,
  getSettings,
  hasCredentials,
  isFullyConfigured,
  ProfilesCacheKey,
  pushRecentAdd,
  setActivity,
  setCache,
  type Settings,
} from '@/lib/storage';
import type {
  AddFromMbResult,
  BatchClientMessage,
  BatchItem,
  BatchItemResult,
  BatchServerMessage,
  CheckExistsResult,
  FetchProfilesResult,
  GetRecentAddsResult,
  Message,
  Response as MsgResponse,
  TestConnectionResult,
} from '@/types/messages';
import { BATCH_PORT_NAME } from '@/types/messages';

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
  notify('Added to Lidarr', `Artist: ${created.artistName}`, lidarrUrl);
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
  notify('Added to Lidarr', `Album: ${created.title}`, lidarrUrl);
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

// Maps notification id → URL to open when the user clicks it (or its "Open" button).
// Lives in module scope; survives normal SW idle but is reset on full SW restart.
// Acceptable because Chrome notifications are short-lived anyway.
const notificationUrls = new Map<string, string>();

function notify(title: string, message: string, url?: string): void {
  try {
    const id = `lfmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const opts: chrome.notifications.NotificationOptions<true> = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icon128.png'),
      title,
      message,
    };
    if (url) {
      opts.buttons = [{ title: 'Open in Lidarr' }];
      notificationUrls.set(id, url);
    }
    chrome.notifications.create(id, opts);
  } catch {
    /* notifications are best-effort */
  }
}

chrome.notifications.onClicked.addListener((id) => {
  const url = notificationUrls.get(id);
  if (url) {
    void chrome.tabs.create({ url });
    chrome.notifications.clear(id);
  }
  notificationUrls.delete(id);
});

chrome.notifications.onButtonClicked.addListener((id, btnIdx) => {
  if (btnIdx !== 0) return;
  const url = notificationUrls.get(id);
  if (url) {
    void chrome.tabs.create({ url });
    chrome.notifications.clear(id);
  }
  notificationUrls.delete(id);
});

chrome.notifications.onClosed.addListener((id) => {
  notificationUrls.delete(id);
});

// ── Right-click context menu ─────────────────────────────────────────────
// Lets the user add a MB entity from any page (including non-MB pages) by
// right-clicking a link whose href contains an artist / release-group / release MBID.

const CONTEXT_MENU_ID = 'lfmb-add';
const CONTEXT_MENU_PATTERNS = [
  'https://musicbrainz.org/artist/*',
  'https://musicbrainz.org/release-group/*',
  'https://musicbrainz.org/release/*',
];

function registerContextMenu(): void {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Add to Lidarr',
        contexts: ['link'],
        targetUrlPatterns: CONTEXT_MENU_PATTERNS,
      });
    });
  } catch (e) {
    console.warn('[lfmb] could not register context menu:', e);
  }
}

chrome.runtime.onInstalled.addListener(registerContextMenu);
chrome.runtime.onStartup.addListener(registerContextMenu);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.linkUrl) return;
  const detected = detectPage(info.linkUrl);
  if (!detected) {
    notify('Lidarr for MusicBrainz', 'No MusicBrainz MBID found in that link.');
    return;
  }
  console.log(`[lfmb] context-menu add kind=${detected.kind} mbid=${detected.mbid}`);

  const activityKind: Activity['kind'] = detected.kind === 'artist' ? 'artist' : 'album';
  const startedAt = Date.now();

  // Record initial state, set badge, and try to open the popup so the user
  // gets immediate feedback while the request is in flight.
  await setActivity({ status: 'adding', kind: activityKind, startedAt });
  setBadge('adding');
  try {
    await chrome.action.openPopup();
  } catch {
    /* requires Chrome 127+ and a user gesture; fall back to badge + notification */
  }

  const res = await handleAddFromMb(detected.kind, detected.mbid);
  const endedAt = Date.now();

  if (!res.ok) {
    await setActivity({
      status: 'error',
      kind: activityKind,
      error: res.error,
      startedAt,
      endedAt,
    });
    setBadge('error');
    notify('Add to Lidarr — Error', res.error);
    scheduleBadgeClear(5000);
    return;
  }

  if (res.status === 'added') {
    await setActivity({
      status: 'added',
      kind: activityKind,
      title: res.title,
      lidarrUrl: res.lidarrUrl,
      startedAt,
      endedAt,
    });
    setBadge('added');
    // The success notification was already fired inside handleAddFromMb.
    scheduleBadgeClear(4000);
    return;
  }

  if (res.status === 'exists') {
    await setActivity({
      status: 'exists',
      kind: activityKind,
      title: res.title,
      lidarrUrl: res.lidarrUrl,
      startedAt,
      endedAt,
    });
    setBadge('exists');
    notify(
      'Already in Lidarr',
      res.title ? `Already in your library: ${res.title}` : 'Already in your library.',
      res.lidarrUrl,
    );
    scheduleBadgeClear(4000);
    return;
  }

  if (res.status === 'not-in-lidarr-metadata') {
    await setActivity({
      status: 'not-in-metadata',
      kind: activityKind,
      startedAt,
      endedAt,
    });
    setBadge('not-in-metadata');
    notify(
      'Not in Lidarr metadata',
      "Lidarr's metadata source (Skyhook) doesn't have this MBID yet.",
    );
    scheduleBadgeClear(4000);
  }
});

// ── Toolbar badge ────────────────────────────────────────────────────────

const BADGE_BY_STATUS: Record<ActivityStatus, { text: string; color: string }> = {
  adding: { text: '…', color: '#f0ad4e' },
  added: { text: '✓', color: '#198754' },
  exists: { text: '✓', color: '#0d6efd' },
  error: { text: '!', color: '#dc3545' },
  'not-in-metadata': { text: '?', color: '#6c757d' },
};

function setBadge(status: ActivityStatus | null): void {
  if (status === null) {
    void chrome.action.setBadgeText({ text: '' });
    return;
  }
  const cfg = BADGE_BY_STATUS[status];
  void chrome.action.setBadgeText({ text: cfg.text });
  void chrome.action.setBadgeBackgroundColor({ color: cfg.color });
  if (chrome.action.setBadgeTextColor) {
    void chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}

let badgeClearTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBadgeClear(ms: number): void {
  if (badgeClearTimer !== null) clearTimeout(badgeClearTimer);
  badgeClearTimer = setTimeout(() => {
    setBadge(null);
    badgeClearTimer = null;
  }, ms);
}

// ── Bulk-add port (section "Add all N" buttons in content script) ────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== BATCH_PORT_NAME) return;
  let aborted = false;
  port.onDisconnect.addListener(() => {
    aborted = true;
  });
  port.onMessage.addListener((msg: BatchClientMessage) => {
    if (msg.type !== 'BATCH_START') return;
    void runBatchAdd(port, msg.items, () => aborted);
  });
});

async function runBatchAdd(
  port: chrome.runtime.Port,
  items: BatchItem[],
  isAborted: () => boolean,
): Promise<void> {
  const send = (m: BatchServerMessage): void => {
    if (isAborted()) return;
    try {
      port.postMessage(m);
    } catch {
      /* port closed mid-flight */
    }
  };

  const s = await getSettings();
  if (!hasCredentials(s)) {
    send({ type: 'BATCH_ERROR', error: 'Set Lidarr URL and API key first.' });
    return;
  }
  if (!isFullyConfigured(s)) {
    send({
      type: 'BATCH_ERROR',
      error: 'Pick a quality profile, metadata profile, and root folder in settings.',
    });
    return;
  }

  console.log(`[lfmb] BATCH_ADD count=${items.length}`);

  let libraryArtists: ArtistRecord[];
  try {
    libraryArtists = await getAllArtists(s);
  } catch (e) {
    send({ type: 'BATCH_ERROR', error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const albumsByArtistId = new Map<number, AlbumRecord[]>();

  for (let i = 0; i < items.length; i++) {
    if (isAborted()) return;
    const item = items[i]!;
    let result: BatchItemResult;
    try {
      result = await processBatchItem(s, item, libraryArtists, albumsByArtistId);
    } catch (e) {
      result = {
        status: 'error',
        mbid: item.mbid,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    send({ type: 'BATCH_PROGRESS', index: i, total: items.length, result });
  }
  send({ type: 'BATCH_DONE', total: items.length });
}

async function processBatchItem(
  s: Settings,
  item: BatchItem,
  libraryArtists: ArtistRecord[],
  albumsByArtistId: Map<number, AlbumRecord[]>,
): Promise<BatchItemResult> {
  const rgMbid =
    item.kind === 'release' ? await resolveReleaseToReleaseGroup(item.mbid) : item.mbid;

  const lookup = await lookupAlbum(s, rgMbid);
  if (!lookup) {
    return { status: 'not-in-metadata', mbid: rgMbid };
  }
  const artistMbidRaw = lookup.artist?.foreignArtistId;
  const artistMbid = artistMbidRaw?.toLowerCase();

  const artist = artistMbid
    ? libraryArtists.find((a) => a.foreignArtistId?.toLowerCase() === artistMbid)
    : undefined;

  if (artist) {
    let albums = albumsByArtistId.get(artist.id);
    if (!albums) {
      albums = await getAlbumsByArtist(s, artist.id);
      albumsByArtistId.set(artist.id, albums);
    }
    const target = rgMbid.toLowerCase();
    const existing = albums.find((a) => a.foreignAlbumId?.toLowerCase() === target);
    if (existing) {
      return {
        status: 'exists',
        mbid: rgMbid,
        title: existing.title,
        lidarrUrl: lidarrArtistUrl(s.baseUrl, artist.foreignArtistId),
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
  const aMbid = created.artist?.foreignArtistId ?? artistMbidRaw;
  const lidarrUrl = aMbid ? lidarrArtistUrl(s.baseUrl, aMbid) : undefined;

  await safePushRecentAdd({
    kind: 'album',
    title: created.title,
    artistName: created.artist?.artistName ?? lookup.artist?.artistName,
    mbid: created.foreignAlbumId ?? rgMbid,
    lidarrUrl,
    mbUrl: `https://musicbrainz.org/release-group/${created.foreignAlbumId ?? rgMbid}`,
    addedAt: Date.now(),
  });

  // Cache the new album so subsequent items in this batch see it.
  if (artist) {
    albumsByArtistId.get(artist.id)?.push(created);
  }

  return {
    status: 'added',
    mbid: created.foreignAlbumId ?? rgMbid,
    title: created.title,
    lidarrUrl,
  };
}
