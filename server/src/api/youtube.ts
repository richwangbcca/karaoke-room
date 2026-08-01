import { youtubeCache, normalizeKey, NEGATIVE_TTL } from '../cache/redisCache';

export type ResolveResult = { videoId?: string; videos?: string[] };

// searchTerm -> in-flight search. Two users adding the same song at once would otherwise
// both miss the cache and both spend 100 quota units on the same query.
const inFlight = new Map<string, Promise<string[]>>();

async function searchYouTube(searchTerm: string): Promise<string[]> {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', searchTerm);
    url.searchParams.set('key', process.env.YOUTUBE_API_KEY ?? '');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('videoSyndicated', 'true');
    url.searchParams.set('maxResults', '10');

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`YouTube search failed with status ${response.status}`);
    }

    const data = await response.json();
    return (data.items ?? []).map((item: any) => item.id?.videoId).filter(Boolean);
}

/**
 * Cache-first video lookup. Returns a known-good `videoId` on a cache hit, otherwise a list of
 * `videos` for the client to test for playability (only a browser can do that). An empty
 * `videos` list means "nothing playable exists" and costs no quota once cached.
 */
export async function resolveVideo(searchTerm: string, skipCache = false): Promise<ResolveResult> {
    const key = normalizeKey(searchTerm);

    if (!skipCache) {
        const cached = await youtubeCache.get(key);
        if (cached) return { videoId: cached };
        if (cached === null) return { videos: [] };
    }

    let pending = inFlight.get(key);
    if (!pending) {
        pending = searchYouTube(key);
        inFlight.set(key, pending);
        pending.catch(() => {}).finally(() => inFlight.delete(key));
    }

    const videos = await pending;
    if (!videos.length) await youtubeCache.set(key, null, NEGATIVE_TTL);

    return { videos };
}
