declare const __GOOGLE_CLIENT_ID__: string;
declare const __BUILD_TIME__: string;

// Google Identity Services (loaded at runtime from accounts.google.com/gsi/client)
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (r: GisTokenResponse) => void;
          error_callback?: (e: { type: string; message?: string }) => void;
        }): GisTokenClient;
        revoke(token: string, done?: () => void): void;
      };
    };
  };
}
