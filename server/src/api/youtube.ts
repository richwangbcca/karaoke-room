import { youtubeCache, normalizeKey, NEGATIVE_TTL } from '../cache/redisCache';

export type ResolveResult = { videoId?: string; videos?: string[]; quotaExhausted?: boolean };

// searchTerm -> in-flight search. Two users adding the same song at once would otherwise
// both miss the cache and both spend 100 quota units on the same query.
const inFlight = new Map<string, Promise<string[]>>();

// A search costs 100 of the 10,000 units the free tier grants per day, so about 100 uncached songs
// before every room on the server stops working. Per-socket limits do not protect this - a caller
// can always reconnect - so the budget is guarded where it is actually spent.
const DAILY_SEARCH_BUDGET = Number(process.env.YOUTUBE_DAILY_SEARCHES ?? 90);

// Counted against Google's own day, which rolls over at midnight Pacific. A rolling 24h window
// drifts across that boundary and can spend two days' worth inside one of Google's.
const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

let searchesUsed = 0;
let budgetDay = pacificDay();

function withinBudget(): boolean {
    const today = pacificDay();
    if (today !== budgetDay) {
        budgetDay = today;
        searchesUsed = 0;
    }
    return searchesUsed < DAILY_SEARCH_BUDGET;
}

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
        // 403 is how YouTube reports a spent daily quota (and a rejected key). Either way there is
        // no point asking again today.
        throw Object.assign(new Error(`YouTube search failed with status ${response.status}`),
            { quotaExhausted: response.status === 403 });
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
        // Checked only on a real miss, so cached songs keep working after the budget is gone.
        // Deliberately not cached as a negative: nothing was searched, so nothing was learned.
        if (!withinBudget()) return { videos: [], quotaExhausted: true };

        searchesUsed++;
        pending = searchYouTube(key);
        inFlight.set(key, pending);
        pending.catch(() => {}).finally(() => inFlight.delete(key));
    }

    let videos: string[];
    try {
        videos = await pending;
    } catch (error: any) {
        // Our own counter can be wrong - a restart clears it, and the key's real quota may differ
        // from YOUTUBE_DAILY_SEARCHES. Upstream is the authority, so believe it and stop for today.
        if (!error?.quotaExhausted) throw error;
        console.error('YouTube refused the search, treating the day as spent:', error.message);
        searchesUsed = DAILY_SEARCH_BUDGET;
        return { videos: [], quotaExhausted: true };
    }

    if (!videos.length) await youtubeCache.set(key, null, NEGATIVE_TTL);

    return { videos };
}
