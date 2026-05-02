# Privacy Policy — Lidarr for MusicBrainz

_Last updated: 2026-05-02_

This is the privacy policy for the **Lidarr for MusicBrainz** Chrome extension ("the extension"), maintained by [Daniel Wagner](https://wgst.at/).

The short version: the extension talks to **two** servers — `musicbrainz.org` and the Lidarr instance you configure — and stores its settings on your own device. Nothing is sent to the author or any third party.

## What is stored, and where

All data the extension stores lives in **your own Chrome profile**, via the standard [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage) API.

| Data | Stored in | Why |
| ---- | --------- | --- |
| Your Lidarr base URL | `chrome.storage.sync` | Needed to call your Lidarr API. |
| Your Lidarr API key | `chrome.storage.sync` | Sent only to your Lidarr server, in the `X-Api-Key` header. |
| Your default quality profile, metadata profile, root folder, monitor mode, search-on-add toggle | `chrome.storage.sync` | Used as defaults when adding new artists/albums. |
| A list of your last 10 additions (entity title, MBID, timestamp, kind) | `chrome.storage.local` | Displayed in the toolbar popup. |
| A short-lived cache of the profile/folder lists fetched from Lidarr | `chrome.storage.local` | Avoids re-fetching profiles every time you open settings. Expires after 1 hour. |

`chrome.storage.sync` syncs across the browsers where you are signed in to the same Chrome profile. `chrome.storage.local` stays on the local machine. Either way, **the extension author and the Web Store have no access to it**.

## What network requests are made

The extension contacts exactly two destinations:

### 1. `musicbrainz.org`

- The content script runs on `https://musicbrainz.org/*` to detect the page type and inject the **Add to Lidarr** button.
- When you trigger an add from a `/release/<mbid>` page, the service worker calls the **public, unauthenticated** MusicBrainz web service to resolve the release to its parent release-group:
  ```
  GET https://musicbrainz.org/ws/2/release/<mbid>?inc=release-groups&fmt=json
  ```
  This is an anonymous lookup — no personal data is sent. The request includes a `User-Agent: LidarrForMusicBrainz/<version> ( https://wgst.at/ )` header per [MusicBrainz API conduct](https://musicbrainz.org/doc/MusicBrainz_API).

### 2. Your Lidarr instance

- All other API calls go to the Lidarr base URL **you configure**. Endpoints used: `/api/v1/system/status`, `/api/v1/qualityprofile`, `/api/v1/metadataprofile`, `/api/v1/rootfolder`, `/api/v1/artist`, `/api/v1/artist/lookup`, `/api/v1/album`, `/api/v1/album/lookup`.
- Every request carries your API key in the `X-Api-Key` header. The key is **never** sent anywhere else.

The extension requests host permission for the Lidarr URL **at runtime**, when you save your settings. You see the standard Chrome permission prompt and can revoke access at any time from `chrome://extensions`.

## What the extension does **not** do

- ❌ No analytics or telemetry of any kind.
- ❌ No advertising, tracking pixels, or third-party scripts.
- ❌ No data sent to the author, the Chrome Web Store beyond the standard install metrics Google itself reports, or any third party.
- ❌ No reading of, or interaction with, pages outside `musicbrainz.org`.

## Permissions and why

| Permission | Why |
| ---------- | --- |
| `storage` | Persist your settings and recent-additions list (described above). |
| `notifications` | Show a system toast when an add succeeds. The notification contains only the title of the added entity. |
| `host_permissions: https://musicbrainz.org/*` | Inject the button into MusicBrainz pages and resolve releases to release-groups. |
| `optional_host_permissions: http://*/*, https://*/*` | Lidarr URLs are user-defined (LAN IPs, Tailscale, custom domains). Only the **specific origin you type into settings** is granted at runtime. The extension never has blanket access to "all websites". |

## Children

The extension is not directed at children under 13.

## Changes

If this policy changes, the new version will be committed to this file. Material changes will also bump the extension's version number on the Chrome Web Store, which surfaces them at update time.

## Contact

Questions, bug reports, or removal requests:

- Author website: <https://wgst.at/>
- Email: [dw@wglc.at](mailto:dw@wglc.at)
- Issue tracker: <https://github.com/DanielWTE/lidarr-for-musicbrainz/issues>

## Open source

The full source code of the extension is published under the MIT license at <https://github.com/DanielWTE/lidarr-for-musicbrainz>. You are encouraged to audit it.
