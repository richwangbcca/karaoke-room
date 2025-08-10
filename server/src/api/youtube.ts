import { Router } from 'express'

export const youtubeRouter = Router();

youtubeRouter.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') {
        return res.status(400).json({error: 'Missing query'});
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'video');
    url.searchParams.set('key', process.env.YOUTUBE_API_KEY ?? '');
    url.searchParams.set('maxResults', '5');

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            return res.status(500).json({ error: 'Search failed' });
        }

        const data = await response.json();

        const results = data.items.map((item: any) => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
        }));

        return res.json(results);
    } catch (err) {
        return res.status(500).send({ error: 'Search failed'});
    }
});