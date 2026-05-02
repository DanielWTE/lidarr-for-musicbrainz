import type {
  AddFromMbResult,
  CheckExistsResult,
  FetchProfilesResult,
  GetRecentAddsResult,
  Message,
  MbEntityKind,
  Response as MsgResponse,
  TestConnectionResult,
} from '@/types/messages';

export function send<T>(msg: Message): Promise<MsgResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: MsgResponse<T>) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message ?? 'Extension messaging error' });
        return;
      }
      resolve(response);
    });
  });
}

export const sendTestConnection = (): Promise<MsgResponse<TestConnectionResult>> =>
  send<TestConnectionResult>({ type: 'TEST_CONNECTION' });

export const sendFetchProfiles = (force = false): Promise<MsgResponse<FetchProfilesResult>> =>
  send<FetchProfilesResult>({ type: 'FETCH_PROFILES', force });

export const sendAddFromMb = (
  kind: 'artist' | 'release-group' | 'release',
  mbid: string,
): Promise<MsgResponse<AddFromMbResult>> =>
  send<AddFromMbResult>({ type: 'ADD_FROM_MB', kind, mbid });

export const sendOpenOptions = (): Promise<MsgResponse<{}>> =>
  send<{}>({ type: 'OPEN_OPTIONS' });

export const sendGetRecentAdds = (): Promise<MsgResponse<GetRecentAddsResult>> =>
  send<GetRecentAddsResult>({ type: 'GET_RECENT_ADDS' });

export const sendCheckExists = (
  kind: MbEntityKind,
  mbid: string,
): Promise<MsgResponse<CheckExistsResult>> =>
  send<CheckExistsResult>({ type: 'CHECK_EXISTS', kind, mbid });
