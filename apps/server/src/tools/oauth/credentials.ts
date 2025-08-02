import { get } from '../env';

export const credentials = {
  tidal: {
    clientId: get('TIDAL_CLIENT_ID'),
    clientSecret: get('TIDAL_CLIENT_SECRET'),
    scopes: [
      'r_usr', // Read user profile, playlists, and collections
      'w_usr', // Create playlists and add tracks (optional feature)
    ].join(' '),
    redirectUri: `${get('API_ENDPOINT')}/oauth/tidal/callback`,
  },
};
