import { Router } from 'express';

export const spotifyRouter = Router();

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getSpotifyToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry) return cachedToken;

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');

    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({ grant_type: 'client_credentials' });

    const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString()
    });

    if (!resp.ok) {
        throw new Error(`Spotify token request failed with status ${resp.status}`);
    }

    const data = await resp.json();
    if (!data?.access_token) throw new Error('No access_token in Spotify response');

    cachedToken = data.access_token;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    tokenExpiry = Date.now() + Math.max(0, (expiresIn - 60)) * 1000;
    
    return cachedToken as string;
}

spotifyRouter.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid query parameter' });
    }

    try {
        const token = await getSpotifyToken();
        
        const url = new URL('https://api.spotify.com/v1/search');
        url.searchParams.append('q', q);
        url.searchParams.append('type', 'track');
        url.searchParams.append('limit', String(5));

        const resp = await fetch(url.toString(), {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!resp.ok) {
            if (resp.status === 401) {
                return res.status(500).json({ error: 'Spotify authentication failed (check client id/secret'});
            }
            if (resp.status === 429) {
                const retryAfter = resp.headers.get('retry-after') || '1';
                return res.status(429).set('Retry-After', retryAfter).json({ error: 'Rate limited by Spotify', retryAfter });
            }
            const details = await resp.text();
            return res.status(502).json( { error: "Spotify API error", status: resp.status, details });
        }

        const data = await resp.json();
        const items = data?.tracks?.items ?? [];

        const results = items.map((track: any) => ({
            trackId: track.id,
            trackName: track.name,
            artists: track.artists.map((artist: any) => artist.name),
            albumImage: track.album?.images?.[0]?.url ?? null,
        }));

        return res.json(results);
    } catch (err: any) {
        return res.status(500).json({ error: 'Search failed', details: String(err?.message ?? err)});
    }
});