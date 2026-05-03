import { sendAddFromMb, sendCheckExists, sendOpenOptions } from '@/lib/messaging';
import { detectPage, MBID_RE, type MbPage } from '@/lib/musicbrainz';
import { getSettings, hasCredentials, onSettingsChanged } from '@/lib/storage';
import {
  type AddFromMbResult,
  BATCH_PORT_NAME,
  type BatchClientMessage,
  type BatchItem,
  type BatchItemStatus,
  type BatchServerMessage,
  type Response as MsgResponse,
} from '@/types/messages';

const BTN_ID = 'lfmb-button';
const TITLE_SELECTORS = [
  'h1.entity-title',
  '#content h1',
  'main h1',
  'div.artistheader h1',
  'div.releaseheader h1',
  'div.release-groupheader h1',
];

let mountedFor: string | null = null;

function findTitleElement(): HTMLElement | null {
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function pageKey(page: MbPage): string {
  return `${page.kind}:${page.mbid}`;
}

function clearExistingButton(): void {
  const existing = document.getElementById(BTN_ID);
  existing?.remove();
  mountedFor = null;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

type ButtonState =
  | 'idle'
  | 'checking'
  | 'loading'
  | 'success'
  | 'exists'
  | 'not-found'
  | 'error'
  | 'unconfigured';

function baseSvg(extraClass = ''): SVGSVGElement {
  return svgEl('svg', {
    class: `lfmb-btn__svg ${extraClass}`.trim(),
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

function buildMusicIcon(): SVGSVGElement {
  const svg = baseSvg();
  svg.appendChild(svgEl('path', { d: 'M9 18V5l12-2v13' }));
  svg.appendChild(svgEl('circle', { cx: '6', cy: '18', r: '3' }));
  svg.appendChild(svgEl('circle', { cx: '18', cy: '16', r: '3' }));
  return svg;
}

function buildPlusIcon(): SVGSVGElement {
  const svg = baseSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('line', { x1: '12', y1: '8', x2: '12', y2: '16' }));
  svg.appendChild(svgEl('line', { x1: '8', y1: '12', x2: '16', y2: '12' }));
  return svg;
}

function buildSpinnerIcon(): SVGSVGElement {
  // A 270° arc that rotates — classic indeterminate spinner.
  const svg = baseSvg('lfmb-btn__svg--spin');
  const arc = svgEl('path', {
    d: 'M21 12a9 9 0 1 1-3.5-7.13',
    'stroke-width': '2.6',
  });
  svg.appendChild(arc);
  return svg;
}

function buildCheckIcon(): SVGSVGElement {
  // A check inside a circle, drawn on entry.
  const svg = baseSvg('lfmb-btn__svg--check');
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  const check = svgEl('path', {
    class: 'lfmb-btn__check-path',
    d: 'M7.5 12.5l3 3 6-6.5',
    'stroke-width': '2.8',
  });
  svg.appendChild(check);
  return svg;
}

function buildLibraryIcon(): SVGSVGElement {
  // For "exists" — a stack-of-records glyph.
  const svg = baseSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '3' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '0.6', fill: 'currentColor' }));
  return svg;
}

function buildAlertIcon(): SVGSVGElement {
  const svg = baseSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('line', { x1: '12', y1: '8', x2: '12', y2: '13' }));
  svg.appendChild(svgEl('circle', { cx: '12', cy: '16.5', r: '0.6', fill: 'currentColor' }));
  return svg;
}

function buildGearIcon(): SVGSVGElement {
  const svg = baseSvg();
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '3' }));
  svg.appendChild(
    svgEl('path', {
      d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z',
    }),
  );
  return svg;
}

function iconForState(state: ButtonState): SVGSVGElement {
  switch (state) {
    case 'idle':
      return buildPlusIcon();
    case 'checking':
    case 'loading':
      return buildSpinnerIcon();
    case 'success':
      return buildCheckIcon();
    case 'exists':
      return buildLibraryIcon();
    case 'not-found':
      return buildMusicIcon();
    case 'error':
      return buildAlertIcon();
    case 'unconfigured':
      return buildGearIcon();
  }
}

function setState(
  btn: HTMLAnchorElement,
  state: ButtonState,
  opts: { label?: string; href?: string; tooltip?: string } = {},
): void {
  const previousState = btn.getAttribute('data-state') as ButtonState | null;
  btn.className = `lfmb-btn lfmb-btn--${state}`;
  btn.setAttribute('data-state', state);

  if (state !== previousState) {
    const iconWrap = btn.querySelector<HTMLSpanElement>('.lfmb-btn__icon');
    if (iconWrap) {
      iconWrap.replaceChildren(iconForState(state));
    }
    if (state === 'success') {
      // Trigger the celebration pulse by toggling a class.
      btn.classList.remove('lfmb-btn--celebrate');
      // Force reflow so the animation restarts even on quick state cycles.
      void btn.offsetWidth;
      btn.classList.add('lfmb-btn--celebrate');
    }
  }

  if (opts.label !== undefined) {
    const labelSpan = btn.querySelector<HTMLSpanElement>('.lfmb-btn__label');
    if (labelSpan) labelSpan.textContent = opts.label;
  }
  if (opts.href) {
    btn.href = opts.href;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
  } else {
    btn.removeAttribute('href');
    btn.removeAttribute('target');
    btn.removeAttribute('rel');
  }
  if (opts.tooltip) btn.title = opts.tooltip;
  else btn.removeAttribute('title');
}

function renderButton(page: MbPage): void {
  const title = findTitleElement();
  if (!title) return;

  const key = pageKey(page);
  if (mountedFor === key && document.getElementById(BTN_ID)) return;

  clearExistingButton();

  const btn = document.createElement('a');
  btn.id = BTN_ID;
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'lfmb-btn__icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  btn.appendChild(iconWrap);

  const label = document.createElement('span');
  label.className = 'lfmb-btn__label';
  label.textContent = 'Add to Lidarr';
  btn.appendChild(label);

  title.appendChild(btn);
  mountedFor = key;

  void initButton(btn, page);
}

async function initButton(btn: HTMLAnchorElement, page: MbPage): Promise<void> {
  const settings = await getSettings();
  if (!hasCredentials(settings)) {
    setState(btn, 'unconfigured', {
      label: 'Configure Lidarr',
      tooltip: 'Open extension settings',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      void sendOpenOptions();
    });
    return;
  }

  // Start in 'checking' state with a spinner; the upfront exists check resolves
  // it to either 'idle' (Add to Lidarr) or 'exists' (In Lidarr).
  setState(btn, 'checking', { label: 'Checking…' });

  btn.addEventListener('click', async (e) => {
    const state = btn.getAttribute('data-state');
    if (state === 'loading' || state === 'checking') {
      e.preventDefault();
      return;
    }
    if (state === 'success' || state === 'exists') {
      if (btn.getAttribute('href')) return; // let the link navigate
    }
    e.preventDefault();
    await runAdd(btn, page);
  });

  void runUpfrontExistsCheck(btn, page);
}

async function runUpfrontExistsCheck(btn: HTMLAnchorElement, page: MbPage): Promise<void> {
  const expectedKey = pageKey(page);
  const res = await sendCheckExists(page.kind, page.mbid);
  // Bail if the page changed or the user already triggered an add while we were checking.
  if (mountedFor !== expectedKey) return;
  const currentState = btn.getAttribute('data-state');
  if (currentState !== 'checking') return;

  if (!res.ok) {
    // Network/auth error: drop to idle so the user can still click and see a real error.
    setState(btn, 'idle', { label: 'Add to Lidarr' });
    return;
  }
  if (res.exists) {
    setState(btn, 'exists', {
      label: 'In Lidarr',
      href: res.lidarrUrl,
      tooltip: res.title ? `Already in Lidarr: ${res.title}` : 'Already in Lidarr',
    });
  } else {
    setState(btn, 'idle', { label: 'Add to Lidarr' });
  }
}

async function runAdd(btn: HTMLAnchorElement, page: MbPage): Promise<void> {
  setState(btn, 'loading', { label: 'Adding…' });
  let res: MsgResponse<AddFromMbResult>;
  try {
    res = await sendAddFromMb(page.kind, page.mbid);
  } catch (e) {
    setState(btn, 'error', {
      label: 'Error',
      tooltip: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!res.ok) {
    setState(btn, 'error', { label: 'Error', tooltip: res.error });
    return;
  }
  if (res.status === 'added') {
    setState(btn, 'success', {
      label: 'Added to Lidarr',
      href: res.lidarrUrl,
      tooltip: res.title ? `Added: ${res.title}` : undefined,
    });
  } else if (res.status === 'exists') {
    setState(btn, 'exists', {
      label: 'In Lidarr',
      href: res.lidarrUrl,
      tooltip: res.title ? `Already in Lidarr: ${res.title}` : 'Already in Lidarr',
    });
  } else if (res.status === 'not-in-lidarr-metadata') {
    setState(btn, 'not-found', {
      label: 'Not in Lidarr',
      tooltip:
        "Lidarr's metadata source (Skyhook) does not have this MBID yet. It can lag behind MusicBrainz.",
    });
  }
}

function tryRender(): void {
  const page = detectPage(location.href);
  if (!page) {
    clearExistingButton();
    clearSectionButtons();
    return;
  }
  if (findTitleElement()) {
    renderButton(page);
    if (page.kind === 'artist') void renderSectionButtons();
    return;
  }
  const observer = new MutationObserver(() => {
    if (findTitleElement()) {
      observer.disconnect();
      renderButton(page);
      if (page.kind === 'artist') void renderSectionButtons();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 5000);
}

// ── Bulk-add: section "+ Add all N" badges ────────────────────────────────

const SECTION_BTN_CLASS = 'lfmb-section-btn';
const RG_HREF_RE =
  /^\/release-group\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function clearSectionButtons(): void {
  document.querySelectorAll(`.${SECTION_BTN_CLASS}`).forEach((b) => b.remove());
}

function findDiscographySections(): { heading: HTMLElement; mbids: string[] }[] {
  const headings = document.querySelectorAll<HTMLElement>('h2, h3, h4');
  const sections: { heading: HTMLElement; mbids: string[] }[] = [];
  headings.forEach((heading) => {
    // Walk forward until we hit a TABLE or another heading.
    let cursor: Element | null = heading.nextElementSibling;
    while (cursor && cursor.tagName !== 'TABLE') {
      if (/^H[1-6]$/.test(cursor.tagName)) {
        cursor = null;
        break;
      }
      cursor = cursor.nextElementSibling;
    }
    if (!cursor) return;
    const links = cursor.querySelectorAll<HTMLAnchorElement>('a[href*="/release-group/"]');
    const mbids: string[] = [];
    links.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(RG_HREF_RE);
      if (!m) return;
      const mbid = m[1]!.toLowerCase();
      if (MBID_RE.test(mbid) && !mbids.includes(mbid)) mbids.push(mbid);
    });
    if (mbids.length > 0) sections.push({ heading, mbids });
  });
  return sections;
}

async function renderSectionButtons(): Promise<void> {
  const settings = await getSettings();
  if (!hasCredentials(settings)) return; // bail when extension isn't configured

  const sections = findDiscographySections();
  for (const { heading, mbids } of sections) {
    if (heading.querySelector(`.${SECTION_BTN_CLASS}`)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${SECTION_BTN_CLASS} ${SECTION_BTN_CLASS}--idle`;
    btn.textContent = `+ Add all ${mbids.length}`;
    btn.title = `Add all ${mbids.length} release-groups in this section to Lidarr`;
    btn.addEventListener('click', () => runSectionBatch(btn, mbids));
    heading.appendChild(btn);
  }
}

function runSectionBatch(btn: HTMLButtonElement, mbids: string[]): void {
  btn.disabled = true;
  btn.className = `${SECTION_BTN_CLASS} ${SECTION_BTN_CLASS}--running`;
  btn.textContent = `Adding 0/${mbids.length}…`;

  const counts: Record<BatchItemStatus, number> = {
    added: 0,
    exists: 0,
    'not-in-metadata': 0,
    error: 0,
  };

  const port = chrome.runtime.connect({ name: BATCH_PORT_NAME });
  port.onMessage.addListener((msg: BatchServerMessage) => {
    if (msg.type === 'BATCH_PROGRESS') {
      counts[msg.result.status] = (counts[msg.result.status] ?? 0) + 1;
      btn.textContent = `Adding ${msg.index + 1}/${msg.total}…`;
    } else if (msg.type === 'BATCH_DONE') {
      const parts: string[] = [];
      if (counts.added > 0) parts.push(`${counts.added} added`);
      if (counts.exists > 0) parts.push(`${counts.exists} in library`);
      if (counts['not-in-metadata'] > 0) parts.push(`${counts['not-in-metadata']} missing`);
      if (counts.error > 0) parts.push(`${counts.error} error`);
      btn.textContent = `✓ ${parts.join(' · ')}`;
      btn.className =
        counts.error > 0
          ? `${SECTION_BTN_CLASS} ${SECTION_BTN_CLASS}--partial`
          : `${SECTION_BTN_CLASS} ${SECTION_BTN_CLASS}--done`;
      btn.disabled = false;
      port.disconnect();
    } else if (msg.type === 'BATCH_ERROR') {
      btn.textContent = `Error: ${msg.error}`;
      btn.className = `${SECTION_BTN_CLASS} ${SECTION_BTN_CLASS}--error`;
      btn.title = msg.error;
      btn.disabled = false;
      port.disconnect();
    }
  });

  const items: BatchItem[] = mbids.map((mbid) => ({ kind: 'release-group', mbid }));
  const start: BatchClientMessage = { type: 'BATCH_START', items };
  port.postMessage(start);
}

tryRender();

const origPushState = history.pushState.bind(history);
const origReplaceState = history.replaceState.bind(history);
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  const ret = origPushState(...args);
  queueMicrotask(tryRender);
  return ret;
};
history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
  const ret = origReplaceState(...args);
  queueMicrotask(tryRender);
  return ret;
};
window.addEventListener('popstate', tryRender);

onSettingsChanged(() => {
  clearExistingButton();
  clearSectionButtons();
  tryRender();
});
