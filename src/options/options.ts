import { sendFetchProfiles, sendTestConnection } from '@/lib/messaging';
import { getSettings, normalizeBaseUrl, setSettings, type Settings } from '@/lib/storage';
import type { MetadataProfile, QualityProfile, RootFolder } from '@/types/lidarr';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
};

const form = $<HTMLFormElement>('settings-form');
const baseUrlEl = $<HTMLInputElement>('baseUrl');
const apiKeyEl = $<HTMLInputElement>('apiKey');
const testBtn = $<HTMLButtonElement>('test-btn');
const testResultEl = $<HTMLSpanElement>('test-result');
const profilesCard = $<HTMLFieldSetElement>('profiles-card');
const qualityEl = $<HTMLSelectElement>('qualityProfileId');
const metadataEl = $<HTMLSelectElement>('metadataProfileId');
const rootFolderEl = $<HTMLSelectElement>('rootFolderPath');
const monitorEl = $<HTMLSelectElement>('monitor');
const searchEl = $<HTMLInputElement>('searchOnAdd');
const saveResultEl = $<HTMLSpanElement>('save-result');
const saveBtn = $<HTMLButtonElement>('save-btn');

let pendingSelections: {
  qualityProfileId: number | null;
  metadataProfileId: number | null;
  rootFolderPath: string | null;
} = { qualityProfileId: null, metadataProfileId: null, rootFolderPath: null };

async function load(): Promise<void> {
  const s = await getSettings();
  baseUrlEl.value = s.baseUrl;
  apiKeyEl.value = s.apiKey;
  monitorEl.value = s.monitor;
  searchEl.checked = s.searchOnAdd;
  pendingSelections = {
    qualityProfileId: s.qualityProfileId,
    metadataProfileId: s.metadataProfileId,
    rootFolderPath: s.rootFolderPath,
  };
  if (s.baseUrl && s.apiKey) {
    void refreshProfiles({ silent: true });
  }
}

function setStatus(
  el: HTMLElement,
  text: string,
  level: 'success' | 'error' | 'warn' | 'neutral',
): void {
  el.textContent = text;
  el.classList.remove('is-success', 'is-error', 'is-warn');
  if (level === 'success') el.classList.add('is-success');
  else if (level === 'error') el.classList.add('is-error');
  else if (level === 'warn') el.classList.add('is-warn');
}

function populateSelect<T>(
  el: HTMLSelectElement,
  items: T[],
  getValue: (it: T) => string,
  getLabel: (it: T) => string,
  selected: string | null,
): void {
  el.replaceChildren();
  for (const it of items) {
    const opt = document.createElement('option');
    opt.value = getValue(it);
    opt.textContent = getLabel(it);
    el.appendChild(opt);
  }
  if (selected !== null && items.some((it) => getValue(it) === selected)) {
    el.value = selected;
  }
}

async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  let origin: string;
  try {
    const u = new URL(baseUrl);
    origin = `${u.protocol}//${u.host}/*`;
  } catch {
    return false;
  }
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function onTestConnection(): Promise<void> {
  baseUrlEl.value = normalizeBaseUrl(baseUrlEl.value);
  const baseUrl = baseUrlEl.value;
  const apiKey = apiKeyEl.value.trim();

  if (!baseUrl || !apiKey) {
    setStatus(testResultEl, 'Enter URL and API key first.', 'warn');
    return;
  }

  testBtn.disabled = true;
  setStatus(testResultEl, 'Requesting host permission…', 'neutral');

  const granted = await ensureHostPermission(baseUrl);
  if (!granted) {
    setStatus(
      testResultEl,
      'Host permission denied — Chrome must allow the extension to reach this URL.',
      'error',
    );
    testBtn.disabled = false;
    return;
  }

  // Persist URL+key first so the SW can read them.
  await setSettings({ baseUrl, apiKey });

  setStatus(testResultEl, 'Testing…', 'neutral');
  const res = await sendTestConnection();
  if (!res.ok) {
    setStatus(testResultEl, res.error, 'error');
    testBtn.disabled = false;
    return;
  }
  setStatus(testResultEl, `Connected to Lidarr v${res.version}`, 'success');
  await refreshProfiles({ silent: false });
  testBtn.disabled = false;
}

async function refreshProfiles({ silent }: { silent: boolean }): Promise<void> {
  const res = await sendFetchProfiles(true);
  if (!res.ok) {
    if (!silent) setStatus(testResultEl, res.error, 'error');
    return;
  }
  populateSelect<QualityProfile>(
    qualityEl,
    res.qualityProfiles,
    (q) => String(q.id),
    (q) => q.name,
    pendingSelections.qualityProfileId !== null
      ? String(pendingSelections.qualityProfileId)
      : null,
  );
  populateSelect<MetadataProfile>(
    metadataEl,
    res.metadataProfiles,
    (m) => String(m.id),
    (m) => m.name,
    pendingSelections.metadataProfileId !== null
      ? String(pendingSelections.metadataProfileId)
      : null,
  );
  populateSelect<RootFolder>(
    rootFolderEl,
    res.rootFolders,
    (r) => r.path,
    (r) => r.path,
    pendingSelections.rootFolderPath,
  );
  profilesCard.disabled = false;
}

async function onSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  saveBtn.disabled = true;
  setStatus(saveResultEl, 'Saving…', 'neutral');

  const baseUrl = normalizeBaseUrl(baseUrlEl.value);
  const apiKey = apiKeyEl.value.trim();
  if (!baseUrl || !apiKey) {
    setStatus(saveResultEl, 'URL and API key are required.', 'error');
    saveBtn.disabled = false;
    return;
  }

  const granted = await ensureHostPermission(baseUrl);
  if (!granted) {
    setStatus(
      saveResultEl,
      'Host permission denied — cannot save until permission is granted.',
      'error',
    );
    saveBtn.disabled = false;
    return;
  }

  if (profilesCard.disabled) {
    setStatus(saveResultEl, 'Test the connection first to load profiles.', 'warn');
    saveBtn.disabled = false;
    return;
  }

  const qualityProfileId = qualityEl.value ? Number(qualityEl.value) : null;
  const metadataProfileId = metadataEl.value ? Number(metadataEl.value) : null;
  const rootFolderPath = rootFolderEl.value || null;

  if (qualityProfileId === null || metadataProfileId === null || rootFolderPath === null) {
    setStatus(saveResultEl, 'Pick a quality profile, metadata profile, and root folder.', 'error');
    saveBtn.disabled = false;
    return;
  }

  const next: Partial<Settings> = {
    baseUrl,
    apiKey,
    qualityProfileId,
    metadataProfileId,
    rootFolderPath,
    monitor: monitorEl.value as Settings['monitor'],
    searchOnAdd: searchEl.checked,
  };
  await setSettings(next);
  pendingSelections = { qualityProfileId, metadataProfileId, rootFolderPath };
  setStatus(saveResultEl, 'Saved.', 'success');
  saveBtn.disabled = false;
}

testBtn.addEventListener('click', () => void onTestConnection());
form.addEventListener('submit', (e) => void onSubmit(e));
baseUrlEl.addEventListener('blur', () => {
  baseUrlEl.value = normalizeBaseUrl(baseUrlEl.value);
});

void load();
