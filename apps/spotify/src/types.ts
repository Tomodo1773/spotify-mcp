export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export type SpotifyAuthProps = Record<string, string> & {
  userId: string;
};
