import 'dotenv/config'; // load .env variables if you have them here
import { getSpotifyToken } from '../src/api/spotify'; // adjust the import path

(async () => {
  try {
    const token = await getSpotifyToken();
    console.log('Spotify token:', token);
  } catch (err) {
    console.error('Error fetching Spotify token:', err);
  }
})();
