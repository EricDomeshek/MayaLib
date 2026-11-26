// Spike-quality Google Drive client: Google Identity Services token flow + Drive v3 REST.
// (In the real app this lives only inside the Drive storage provider; design §4, §16.)

export const SCOPES = {
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
  drive: 'https://www.googleapis.com/auth/drive',
} as const;
export type ScopeName = keyof typeof SCOPES;

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_NAME = 'MayaLib-Spike0';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface Token { accessToken: string; expiresAt: number; scope: string }
let token: Token | null = null;
const tokenListeners = new Set<() => void>();
export const getToken = () => token;
export const onToken = (l: () => void) => { tokenListeners.add(l); return () => tokenListeners.delete(l); };

export function clientId(): string {
  return localStorage.getItem('spike0.clientId') || __GOOGLE_CLIENT_ID__;
}

let gisLoading: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return (gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('Failed to load Google Identity Services script')); };
    document.head.appendChild(s);
  }));
}

/** Ask Google for an access token. prompt '' = silent if possible; 'consent' = always show the consent screen. */
export async function requestToken(scope: ScopeName, prompt: '' | 'consent' | 'select_account'): Promise<Token> {
  await loadGis();
  const id = clientId();
  if (!id) throw new Error('No OAuth client ID configured');
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPES[scope],
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(`${r.error ?? 'no_token'}: ${r.error_description ?? ''}`));
          return;
        }
        token = { accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 0) * 1000, scope: r.scope ?? '' };
        tokenListeners.forEach((l) => l());
        resolve(token);
      },
      error_callback: (e) => reject(new Error(`${e.type}: ${e.message ?? ''}`)),
    });
    client.requestAccessToken({ prompt });
  });
}

/** Revoke the grant at Google. Rejects if Google (or the browser) reports a failure. */
export function revoke(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!token || !window.google) { resolve(); return; }
    window.google.accounts.oauth2.revoke(token.accessToken, (r) => {
      if (r && r.successful === false) {
        reject(new Error(`revoke failed: ${r.error ?? 'unknown'} ${r.error_description ?? ''}`.trim()));
        return;
      }
      token = null;
      tokenListeners.forEach((l) => l());
      resolve();
    });
  });
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  if (!token) throw new Error('Not connected');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token.accessToken}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

const q = (s: string) => encodeURIComponent(s);
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export interface DriveFile {
  id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string;
  headRevisionId?: string; md5Checksum?: string; version?: string;
}

export async function findOrCreateFolder(): Promise<{ id: string; created: boolean }> {
  const query = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await (await call(`${API}/files?q=${q(query)}&fields=files(id,name)`)).json();
  if (r.files?.length) return { id: r.files[0].id, created: false };
  const c = await (await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  })).json();
  return { id: c.id, created: true };
}

export async function uploadFile(folderId: string, name: string, body: Blob, mimeType: string): Promise<DriveFile> {
  const boundary = 'mayalib' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [folderId], mimeType });
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, body, `\r\n--${boundary}--`,
  ]);
  const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size,modifiedTime,headRevisionId,md5Checksum,version`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return res.json();
}

export async function updateContent(fileId: string, body: Blob, mimeType: string): Promise<DriveFile> {
  const res = await call(`${UPLOAD}/files/${fileId}?uploadType=media&fields=id,name,size,modifiedTime,headRevisionId,md5Checksum,version`, {
    method: 'PATCH',
    headers: { 'Content-Type': mimeType },
    body,
  });
  return res.json();
}

export async function getMeta(fileId: string): Promise<DriveFile> {
  return (await call(`${API}/files/${fileId}?fields=id,name,size,modifiedTime,headRevisionId,md5Checksum,version`)).json();
}

export async function readText(fileId: string): Promise<string> {
  return (await call(`${API}/files/${fileId}?alt=media`)).text();
}

export async function readRange(fileId: string, start: number, end: number): Promise<{ status: number; bytes: number; contentRange: string | null }> {
  const res = await call(`${API}/files/${fileId}?alt=media`, { headers: { Range: `bytes=${start}-${end}` } });
  const buf = await res.arrayBuffer();
  return { status: res.status, bytes: buf.byteLength, contentRange: res.headers.get('Content-Range') };
}

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const query = `'${esc(folderId)}' in parents and trashed=false`;
  const r = await (await call(`${API}/files?q=${q(query)}&pageSize=200&fields=files(id,name,mimeType,size,modifiedTime)`)).json();
  return r.files ?? [];
}

export async function fullTextSearch(folderId: string, term: string): Promise<DriveFile[]> {
  const query = `fullText contains '${esc(term)}' and '${esc(folderId)}' in parents and trashed=false`;
  const r = await (await call(`${API}/files?q=${q(query)}&fields=files(id,name)`)).json();
  return r.files ?? [];
}

export async function startPageToken(): Promise<string> {
  return (await (await call(`${API}/changes/startPageToken`)).json()).startPageToken;
}

export async function changesSince(pageToken: string): Promise<{ count: number; names: string[]; newStartPageToken?: string }> {
  const r = await (await call(`${API}/changes?pageToken=${q(pageToken)}&fields=newStartPageToken,nextPageToken,changes(fileId,removed,file(name))`)).json();
  const changes: { file?: { name?: string } }[] = r.changes ?? [];
  return { count: changes.length, names: changes.map((c) => c.file?.name ?? '?'), newStartPageToken: r.newStartPageToken };
}
