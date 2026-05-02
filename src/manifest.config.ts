import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Lidarr for MusicBrainz',
  version: pkg.version,
  description: pkg.description,
  icons: {
    16: 'public/icon16.png',
    48: 'public/icon48.png',
    128: 'public/icon128.png',
  },
  permissions: ['storage', 'notifications'],
  host_permissions: ['https://musicbrainz.org/*'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  content_scripts: [
    {
      matches: ['https://musicbrainz.org/*'],
      js: ['src/content/index.ts'],
      css: ['src/content/content.css'],
      run_at: 'document_idle',
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/options.html',
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Lidarr for MusicBrainz',
    default_icon: {
      16: 'public/icon16.png',
      48: 'public/icon48.png',
      128: 'public/icon128.png',
    },
  },
});
