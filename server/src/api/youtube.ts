import { Router } from 'express'
import axios from 'axios'

export const youtubeRouter = Router();

youtubeRouter.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') {
        return res.status(400).json({error: 'Missing query'});
    }

    try {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q,
                type: 'video',
                key: process.env.YOUTUBE_API_KEY,
                maxResults: 5,
            },
        });

        const results = response.data.items.map((item: any) => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
            thumbnail: item.snippet.thumbnails.default.url,
        }));

        return res.json(results);
    } catch (err) {
        return res.status(500).send({ error: 'Search failed'});
    }
});