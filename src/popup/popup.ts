import { sendGetRecentAdds, sendTestConnection } from '@/lib/messaging';
import {
  type Activity,
  ActivityKey,
  getActivity,
  getSettings,
  hasCredentials,
  type RecentAdd,
} from '@/lib/storage';

const $ = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const pill = $<HTMLSpanElement>('status-pill');
const urlEl = $<HTMLAnchorElement>('base-url');
const openOptionsBtn = $<HTMLButtonElement>('open-options');
const recentList = $<HTMLUListElement>('recent-list');
const recentEmpty = $<HTMLParagraphElement>('recent-empty');
const recentCount = $<HTMLSpanElement>('recent-count');
const versionTag = $<HTMLSpanElement>('version-tag');
const activityBanner = $<HTMLAnchorElement>('activity-banner');

function setPill(text: string, level: 'ok' | 'err' | 'warn' | 'neutral'): void {
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove('is-ok', 'is-err', 'is-warn');
  if (level === 'ok') pill.classList.add('is-ok');
  else if (level === 'err') pill.classList.add('is-err');
  else if (level === 'warn') pill.classList.add('is-warn');
}

function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 45_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.round(diff / (24 * 60 * 60_000))}d ago`;
  const d = new Date(epochMs);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function rowSvg(): SVGSVGElement {
  return svgEl('svg', {
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

function buildArtistGlyph(): SVGSVGElement {
  // Microphone glyph.
  const svg = rowSvg();
  svg.appendChild(svgEl('rect', { x: '9', y: '3', width: '6', height: '11', rx: '3' }));
  svg.appendChild(svgEl('path', { d: 'M5 11a7 7 0 0 0 14 0' }));
  svg.appendChild(svgEl('line', { x1: '12', y1: '18', x2: '12', y2: '21' }));
  svg.appendChild(svgEl('line', { x1: '8.5', y1: '21', x2: '15.5', y2: '21' }));
  return svg;
}

function buildAlbumGlyph(): SVGSVGElement {
  // Vinyl/disc glyph.
  const svg = rowSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '3' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '0.8', fill: 'currentColor' }));
  return svg;
}

function bannerSvg(extraClass = ''): SVGSVGElement {
  return svgEl('svg', {
    class: extraClass,
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

function buildBannerSpinner(): SVGSVGElement {
  const svg = bannerSvg();
  svg.appendChild(svgEl('path', { d: 'M21 12a9 9 0 1 1-3.5-7.13' }));
  return svg;
}
function buildBannerCheck(): SVGSVGElement {
  const svg = bannerSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('path', { d: 'M7.5 12.5l3 3 6-6.5' }));
  return svg;
}
function buildBannerLibrary(): SVGSVGElement {
  const svg = bannerSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '3' }));
  return svg;
}
function buildBannerAlert(): SVGSVGElement {
  const svg = bannerSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('line', { x1: '12', y1: '8', x2: '12', y2: '13' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '16.5', r: '0.6', fill: 'currentColor' }));
  return svg;
}
function buildBannerQuestion(): SVGSVGElement {
  const svg = bannerSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('path', { d: 'M9.4 9.5a2.6 2.6 0 0 1 5.2 0c0 1.5-2.6 1.9-2.6 3.5' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '16.5', r: '0.6', fill: 'currentColor' }));
  return svg;
}

function buildChevron(): SVGSVGElement {
  const svg = bannerSvg('banner__chevron');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.appendChild(svgEl('path', { d: 'M9 6l6 6-6 6' }));
  return svg;
}

const ACTIVITY_FRESH_MS = 30_000; // hide banner if older than this

function activityCopy(a: Activity): { title: string; sub: string } {
  const kindWord = a.kind === 'artist' ? 'Artist' : 'Album';
  switch (a.status) {
    case 'adding':
      return {
        title: a.title ? `Adding ${a.title}…` : `Adding ${kindWord.toLowerCase()}…`,
        sub: 'Talking to Lidarr',
      };
    case 'added':
      return {
        title: a.title ? `Added: ${a.title}` : `${kindWord} added`,
        sub: a.lidarrUrl ? 'Click to open in Lidarr' : 'Successfully added',
      };
    case 'exists':
      return {
        title: a.title ? `Already in Lidarr: ${a.title}` : 'Already in Lidarr',
        sub: a.lidarrUrl ? 'Click to open in Lidarr' : `${kindWord} is already in your library`,
      };
    case 'error':
      return {
        title: 'Add failed',
        sub: a.error ?? 'Something went wrong',
      };
    case 'not-in-metadata':
      return {
        title: 'Not in Lidarr metadata',
        sub: "Skyhook doesn't have this MBID yet",
      };
  }
}

function bannerIcon(status: Activity['status']): SVGSVGElement {
  switch (status) {
    case 'adding': return buildBannerSpinner();
    case 'added': return buildBannerCheck();
    case 'exists': return buildBannerLibrary();
    case 'error': return buildBannerAlert();
    case 'not-in-metadata': return buildBannerQuestion();
  }
}

function renderBanner(a: Activity | null): void {
  if (!activityBanner) return;
  if (!a) {
    activityBanner.hidden = true;
    return;
  }
  const referenceTime = a.endedAt ?? a.startedAt;
  if (a.status !== 'adding' && Date.now() - referenceTime > ACTIVITY_FRESH_MS) {
    activityBanner.hidden = true;
    return;
  }
  activityBanner.hidden = false;
  activityBanner.className = `banner banner--${a.status}`;
  activityBanner.replaceChildren();

  const iconWrap = document.createElement('span');
  iconWrap.className = 'banner__icon';
  iconWrap.appendChild(bannerIcon(a.status));
  activityBanner.appendChild(iconWrap);

  const body = document.createElement('span');
  body.className = 'banner__body';
  const copy = activityCopy(a);
  const title = document.createElement('div');
  title.className = 'banner__title';
  title.textContent = copy.title;
  const sub = document.createElement('div');
  sub.className = 'banner__sub';
  sub.textContent = copy.sub;
  body.appendChild(title);
  body.appendChild(sub);
  activityBanner.appendChild(body);

  const navigable = (a.status === 'added' || a.status === 'exists') && Boolean(a.lidarrUrl);
  if (navigable) {
    activityBanner.href = a.lidarrUrl!;
    activityBanner.target = '_blank';
    activityBanner.rel = 'noopener noreferrer';
    activityBanner.appendChild(buildChevron());
  } else {
    activityBanner.removeAttribute('href');
    activityBanner.removeAttribute('target');
    activityBanner.removeAttribute('rel');
  }
}

async function refreshActivity(): Promise<void> {
  const a = await getActivity();
  renderBanner(a);
}

function renderRecent(items: RecentAdd[]): void {
  if (!recentList || !recentEmpty) return;
  recentList.replaceChildren();
  if (items.length === 0) {
    recentList.classList.add('is-hidden');
    recentEmpty.classList.remove('is-hidden');
    if (recentCount) recentCount.textContent = '';
    return;
  }
  recentList.classList.remove('is-hidden');
  recentEmpty.classList.add('is-hidden');
  if (recentCount) recentCount.textContent = `${items.length}`;

  for (const it of items) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'row-link';
    if (it.lidarrUrl) {
      link.href = it.lidarrUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = `Open in Lidarr — ${it.lidarrUrl}`;
    } else {
      link.title = it.title;
    }

    const icon = document.createElement('span');
    icon.className = `row-icon row-icon--${it.kind}`;
    icon.appendChild(it.kind === 'artist' ? buildArtistGlyph() : buildAlbumGlyph());
    link.appendChild(icon);

    const body = document.createElement('span');
    body.className = 'row-body';

    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = it.title;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'row-meta';
    if (it.kind === 'album' && it.artistName) {
      meta.textContent = `by ${it.artistName}`;
    } else {
      meta.textContent = it.kind === 'artist' ? 'Artist' : 'Album';
    }
    body.appendChild(meta);

    link.appendChild(body);

    const time = document.createElement('span');
    time.className = 'row-time';
    time.textContent = relativeTime(it.addedAt);
    link.appendChild(time);

    li.appendChild(link);
    recentList.appendChild(li);
  }
}

async function init(): Promise<void> {
  if (versionTag) {
    versionTag.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const s = await getSettings();
  if (urlEl) {
    if (s.baseUrl) {
      urlEl.textContent = s.baseUrl;
      urlEl.href = s.baseUrl;
    } else {
      urlEl.textContent = 'No Lidarr URL configured';
      urlEl.removeAttribute('href');
    }
  }

  if (!hasCredentials(s)) {
    setPill('Not configured', 'warn');
  } else {
    setPill('Checking…', 'neutral');
    const res = await sendTestConnection();
    if (res.ok) setPill(`Connected (v${res.version})`, 'ok');
    else setPill(res.error.length > 36 ? `${res.error.slice(0, 36)}…` : res.error, 'err');
  }

  await refreshActivity();

  const recent = await sendGetRecentAdds();
  renderRecent(recent.ok ? recent.items : []);
}

// Live-update the banner if the SW changes activity while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[ActivityKey]) void refreshActivity();
  // If a recent-add was pushed (e.g. the context-menu add succeeded), refresh the list.
  if (changes['recentAdds']) {
    void sendGetRecentAdds().then((res) => {
      if (res.ok) renderRecent(res.items);
    });
  }
});

openOptionsBtn?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void init();
