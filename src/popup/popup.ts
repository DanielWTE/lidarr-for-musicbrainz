import { sendGetRecentAdds, sendTestConnection } from '@/lib/messaging';
import { getSettings, hasCredentials, type RecentAdd } from '@/lib/storage';

const $ = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const pill = $<HTMLSpanElement>('status-pill');
const urlEl = $<HTMLAnchorElement>('base-url');
const openOptionsBtn = $<HTMLButtonElement>('open-options');
const recentList = $<HTMLUListElement>('recent-list');
const recentEmpty = $<HTMLParagraphElement>('recent-empty');
const recentCount = $<HTMLSpanElement>('recent-count');
const versionTag = $<HTMLSpanElement>('version-tag');

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

  const recent = await sendGetRecentAdds();
  renderRecent(recent.ok ? recent.items : []);
}

openOptionsBtn?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void init();
