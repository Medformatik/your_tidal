import { get } from '../env';

export const credentials = {
  tidal: {
    clientId: get('TIDAL_CLIENT_ID'),
    clientSecret: get('TIDAL_CLIENT_SECRET'),
    scopes: [
      'user.read',
      'playlists.read',
      'playlists.write',
      'collection.read',
      'search.read',
    ].join(','),
    redirectUri: `${get('API_ENDPOINT')}/oauth/tidal/callback`,
  },
};
