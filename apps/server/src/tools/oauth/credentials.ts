import { get } from '../env';

export const credentials = {
  tidal: {
    clientId: get('TIDAL_CLIENT_ID'),
    clientSecret: get('TIDAL_CLIENT_SECRET'),
    scopes: [
      'user.read',           // For /users/me endpoint
      'playlists.read',      // For getting user playlists  
      'playlists.write',     // For creating/modifying playlists
      'collection.read',     // For user collections
      'search.read',         // For search functionality
      'r_usr',              // Required for user-related read operations
      'w_usr'               // Required for user-related write operations
    ].join(' '),
    redirectUri: `${get('API_ENDPOINT')}/oauth/tidal/callback`,
  },
};
