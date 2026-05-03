export const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MbPage =
  | { kind: 'artist'; mbid: string }
  | { kind: 'release-group'; mbid: string }
  | { kind: 'release'; mbid: string };

const PATH_RE =
  /^\/(artist|release-group|release)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$|[?#])/i;

export function detectPage(href: string): MbPage | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== 'musicbrainz.org' && !url.hostname.endsWith('.musicbrainz.org')) {
    return null;
  }
  const m = url.pathname.match(PATH_RE);
  if (!m) return null;
  const kindRaw = m[1]!.toLowerCase();
  const mbid = m[2]!.toLowerCase();
  if (kindRaw === 'artist') return { kind: 'artist', mbid };
  if (kindRaw === 'release-group') return { kind: 'release-group', mbid };
  if (kindRaw === 'release') return { kind: 'release', mbid };
  return null;
}

// Per MusicBrainz API conduct, requests must include a User-Agent that
// identifies the app and a way to contact the author.
// https://musicbrainz.org/doc/MusicBrainz_API
export const MB_USER_AGENT =
  'LidarrForMusicBrainz/0.3.0 ( https://wgst.at/ )';

export type MbReleaseLookup = {
  id: string;
  'release-group': { id: string; title?: string };
  title?: string;
};

export async function resolveReleaseToReleaseGroup(releaseMbid: string): Promise<string> {
  const url = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseMbid)}?inc=release-groups&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': MB_USER_AGENT,
      },
    });
  } catch {
    throw new Error('Could not reach musicbrainz.org to resolve release.');
  }
  if (!res.ok) {
    throw new Error(`MusicBrainz returned HTTP ${res.status} resolving release ${releaseMbid}.`);
  }
  const data = (await res.json()) as MbReleaseLookup;
  const rgId = data['release-group']?.id;
  if (!rgId) {
    throw new Error(`MusicBrainz response had no release-group for release ${releaseMbid}.`);
  }
  return rgId.toLowerCase();
}
