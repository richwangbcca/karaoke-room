import 'dotenv/config';
import assert from 'assert';
import { useTestDb } from './testDb';

// Counts real YouTube calls without spending quota. Needs a running redis-server.
// Run: pnpm exec ts-node tests/testVideoCache.ts
let apiCalls = 0;
let nextItems: any[] = [];
let nextStatus = 200;

(global as any).fetch = async () => {
    apiCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return { ok: nextStatus === 200, status: nextStatus, json: async () => ({ items: nextItems }) };
};

const song = (n: string) => `${n} karaoke`;

async function main() {
    await useTestDb();
    process.env.YOUTUBE_DAILY_SEARCHES = '20'; // read at load, so it must be set before the require
    const { resolveVideo } = require('../src/api/youtube');
    // Cache hit costs no quota
    nextItems = [{ id: { videoId: 'abc123' } }];
    const miss = song('hit');
    assert.deepStrictEqual((await resolveVideo(miss)).videos, ['abc123']);
    assert.strictEqual(apiCalls, 1, 'a miss should search');

    // Only the host can confirm a video plays, so simulate it reporting the winner back
    const { youtubeCache } = require('../src/cache/redisCache');
    await youtubeCache.set(miss, 'abc123');
    assert.strictEqual((await resolveVideo(miss)).videoId, 'abc123');
    assert.strictEqual(apiCalls, 1, 'a hit must not search');

    // skipCache forces a fresh search past a stale entry
    await resolveVideo(miss, true);
    assert.strictEqual(apiCalls, 2, 'skipCache should search');

    // Negative caching: no results is remembered, so the dud costs quota only once
    nextItems = [];
    const dud = song('dud');
    assert.deepStrictEqual((await resolveVideo(dud)).videos, []);
    assert.deepStrictEqual((await resolveVideo(dud)).videos, []);
    assert.strictEqual(apiCalls, 3, 'a known-empty search must not repeat');

    // In-flight dedup: concurrent identical misses share one search
    nextItems = [{ id: { videoId: 'xyz789' } }];
    const both = song('race');
    const [a, b] = await Promise.all([resolveVideo(both), resolveVideo(both)]);
    assert.deepStrictEqual(a.videos, ['xyz789']);
    assert.deepStrictEqual(b.videos, ['xyz789']);
    assert.strictEqual(apiCalls, 4, 'concurrent misses should share one search');

    // A 403 is YouTube saying the day's quota is gone. Our own counter can be wrong - a restart
    // clears it - so upstream wins and the rest of the day stops costing calls.
    nextStatus = 403;
    const refused = await resolveVideo(song('over-quota'));
    assert.strictEqual(refused.quotaExhausted, true, 'a 403 must surface as an exhausted quota');
    assert.strictEqual(apiCalls, 5, 'the refused search still reached the API once');

    nextStatus = 200;
    const later = await resolveVideo(song('after-quota'));
    assert.strictEqual(later.quotaExhausted, true, 'the rest of the day must not search');
    assert.strictEqual(apiCalls, 5, 'a lookup past the budget must not reach the API');
    assert.strictEqual(await youtubeCache.get(song('after-quota')), undefined,
        'nothing was searched, so nothing may be cached as a negative');

    // The room can still sing whatever it already looked up
    assert.strictEqual((await resolveVideo(miss)).videoId, 'abc123',
        'a cached song must still play once the budget is gone');

    console.log(`OK - 4 API calls for 8 lookups, budget and quota guards hold`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
