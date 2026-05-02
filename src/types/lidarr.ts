export type QualityProfile = {
  id: number;
  name: string;
};

export type MetadataProfile = {
  id: number;
  name: string;
};

export type RootFolder = {
  id: number;
  path: string;
  name?: string;
  accessible?: boolean;
  freeSpace?: number;
};

export type SystemStatus = {
  version: string;
  appName?: string;
  instanceName?: string;
};

export type MonitorOption =
  | 'all'
  | 'future'
  | 'missing'
  | 'existing'
  | 'latest'
  | 'first'
  | 'none';

export type ArtistAddOptions = {
  monitor: MonitorOption;
  searchForMissingAlbums: boolean;
  monitored?: boolean;
};

export type AlbumAddOptions = {
  searchForNewAlbum: boolean;
  monitored?: boolean;
};

export type ArtistLookupResult = {
  foreignArtistId: string;
  artistName: string;
  cleanName?: string;
  sortName?: string;
  status?: string;
  ended?: boolean;
  artistType?: string;
  disambiguation?: string;
  overview?: string;
  remotePoster?: string;
  images?: unknown[];
  links?: unknown[];
  genres?: string[];
  ratings?: unknown;
  [k: string]: unknown;
};

export type ArtistRecord = ArtistLookupResult & {
  id: number;
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  path?: string;
};

export type AlbumLookupResult = {
  foreignAlbumId: string;
  title: string;
  disambiguation?: string;
  overview?: string;
  releaseDate?: string;
  albumType?: string;
  secondaryTypes?: string[];
  remoteCover?: string;
  images?: unknown[];
  links?: unknown[];
  genres?: string[];
  ratings?: unknown;
  artist: ArtistLookupResult;
  releases?: unknown[];
  [k: string]: unknown;
};

export type AlbumRecord = AlbumLookupResult & {
  id: number;
  artistId: number;
  monitored: boolean;
  artist: ArtistRecord;
};

export type LidarrAddArtistPayload = ArtistLookupResult & {
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  addOptions: ArtistAddOptions;
};

export type LidarrAddAlbumPayload = AlbumLookupResult & {
  monitored: boolean;
  artist: ArtistLookupResult & {
    qualityProfileId: number;
    metadataProfileId: number;
    rootFolderPath: string;
    monitored: boolean;
  };
  addOptions: AlbumAddOptions;
};
