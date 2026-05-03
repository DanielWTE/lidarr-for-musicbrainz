# Lidarr for MusicBrainz

A Chrome extension (Manifest V3) that adds a one-click **Add to Lidarr** button to artist, release-group, and release pages on [musicbrainz.org](https://musicbrainz.org). It connects to your self-hosted [Lidarr](https://lidarr.audio) instance and uses Lidarr's standard `lidarr:<mbid>` lookup so the metadata always lines up.

## Features

- 🎤 Add **artists** in one click from `/artist/<mbid>` pages.
- 💿 Add **albums** from `/release-group/<mbid>` pages.
- 🔗 On `/release/<mbid>` pages, the extension resolves the parent release-group automatically before adding.
- ✅ The button checks your library on page load and shows **In Lidarr** with a deep link if the entity already exists.
- 🔔 A Chrome notification fires after each successful add so you can keep browsing.
- 🕘 The toolbar popup shows your last 10 additions with quick links back to Lidarr.
- 🔒 Works against any Lidarr URL (LAN IP, Tailscale, reverse proxy). Host permission is requested at runtime, only for the URL you actually configure.
- 🌓 Light/dark mode follows your system preference.
- 🖱️ **Right-click any MusicBrainz link** (on any page — Reddit, Discord, blogs, MB discography lists) and pick **Add to Lidarr** without navigating to it first.
- 📚 **Bulk-add a whole section** (Album, EP, Single, etc.) from an artist's discography with one click. Live progress on the badge: `Adding 4/11…` → `✓ 8 added · 2 in library · 1 missing`.

## Install

### From source (until the Web Store listing is live)

```bash
git clone https://github.com/DanielWTE/lidarr-for-musicbrainz.git
cd lidarr-for-musicbrainz
npm install
npm run build
```

Then in Chrome (or Edge / Brave / Vivaldi):

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `dist/` directory inside the cloned repo.

The extension icon appears in your toolbar.

## Configure

1. Right-click the toolbar icon → **Options** (or `chrome://extensions` → **Details** → **Extension options**).
2. Enter your **Lidarr base URL** (e.g. `http://10.1.0.108:8686`).
3. Enter your **API key** (Lidarr → Settings → General → Security).
4. Click **Test connection**. Chrome will prompt for host permission for that URL — approve it.
5. Pick a **Quality profile**, **Metadata profile**, and **Root folder**.
6. Choose **Monitor new items** (default `all`) and **Search on add** (default on).
7. Click **Save**.

## Use

Visit any MusicBrainz page, e.g. https://musicbrainz.org/artist/2b0a8be6-bfb8-4f62-b21d-f47a3104157e. You'll see an **Add to Lidarr** button next to the title:

| State              | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| **Checking…**      | Looking up your Lidarr library on page load.                                         |
| **Add to Lidarr**  | Idle — click to add.                                                                 |
| **Adding…**        | POST in flight.                                                                      |
| **Added to Lidarr**| Success. Click to open the artist in Lidarr.                                         |
| **In Lidarr**      | Already in your library. Click to open it there.                                     |
| **Not in Lidarr**  | Lidarr's metadata source (Skyhook) doesn't have this MBID yet — try again later.     |
| **Error**          | Hover for the message; check Lidarr is reachable and the API key is valid.           |
| **Configure Lidarr** | URL or API key missing. Click to open the settings page.                           |

## Permissions

| Permission | Why it's needed |
| ---------- | --------------- |
| `storage` | Persist your settings (URL, API key, profile choices) and the recent-additions list. |
| `notifications` | Show a toast after each successful add. |
| `host_permissions: https://musicbrainz.org/*` | Inject the button into MusicBrainz pages and resolve `/release/<mbid>` → release-group via the MB web service. |
| `optional_host_permissions: http://*/*, https://*/*` | Lidarr URLs are user-defined (commonly LAN IPs or self-hosted domains). Only the **specific origin you configure** is granted at runtime via `chrome.permissions.request`. The extension never gets blanket access. |

All Lidarr API calls happen in the **background service worker**, so your HTTPS MusicBrainz tab never makes HTTP requests itself — sidestepping mixed-content blocks against LAN HTTP Lidarr instances.

## Develop

```bash
npm install
npm run dev        # vite + @crxjs HMR
npm run build      # production build → dist/
npm run typecheck  # strict TypeScript check
npm run zip        # build + zip dist/ as lidarr-for-musicbrainz-v<version>.zip
```

The dev build is loadable as unpacked (point Chrome at `dist/`). Hot-reload works for content scripts, the options page, and the popup; reload the extension manually after service-worker changes.

## Release

CI runs typecheck + build on every push to `main` and every PR.

To cut a new release:

```bash
npm version patch        # or minor / major — bumps package.json + creates a git tag
git push --follow-tags
```

The push of a `v*.*.*` tag triggers `.github/workflows/release.yml`, which:

1. Verifies the tag matches `package.json` version.
2. Runs typecheck + build.
3. Creates a GitHub Release with auto-generated notes and the ready-to-upload `.zip` attached.

Published releases live at <https://github.com/DanielWTE/lidarr-for-musicbrainz/releases>.

## Project layout

```
src/
├── manifest.config.ts      # @crxjs defineManifest()
├── background/index.ts     # SW: dispatcher + Lidarr client orchestration
├── content/                # Injected into musicbrainz.org
│   ├── index.ts            # Page detection, button injection, state machine
│   └── content.css         # Scoped button styles (lfmb- prefix)
├── options/                # Settings page
├── popup/                  # Toolbar popup (status + recent adds)
├── lib/
│   ├── lidarr.ts           # Typed Lidarr v1 API client
│   ├── musicbrainz.ts      # MBID parser, page detection, release→RG resolver
│   ├── storage.ts          # chrome.storage.sync settings + chrome.storage.local cache
│   └── messaging.ts        # Typed wrappers around chrome.runtime.sendMessage
└── types/                  # Shared TS types
scripts/
└── generate-icons.mjs      # Procedural icon PNGs (sharp)
```

Logging: the SW emits one concise `[lfmb] …` line per significant event (CHECK_EXISTS, ADD_FROM_MB, library-match results, errors). Inspect via `chrome://extensions` → click *service worker* under "Inspect views".

## Roadmap

- [ ] Localization (DE first).
- [ ] Chrome Web Store listing.
- [ ] Vitest coverage for `lib/` modules.

## Contributing

PRs welcome — please run `npm run typecheck && npm run build` before opening one. For substantive changes, open an issue first to discuss the approach.

## Privacy

The extension only talks to musicbrainz.org and your own Lidarr instance. Nothing is sent to the author or any third party. See [PRIVACY.md](./PRIVACY.md) for the full policy.

## License

[MIT](./LICENSE) © [Daniel Wagner](https://wgst.at/)
