import 'dotenv/config';
import assert from 'assert';
import { resolveVideo } from '../src/api/youtube';

// Counts real YouTube calls without spending quota. Needs a running redis-server.
// Run: pnpm exec ts-node tests/testVideoCache.ts
let apiCalls = 0;
let nextItems: any[] = [];

(global as any).fetch = async () => {
    apiCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return { ok: true, json: async () => ({ items: nextItems }) };
};

const song = (n: string) => `${n} ${Date.now()} karaoke`;

async function main() {
    // Cache hit costs no quota
    nextItems = [{ id: { videoId: 'abc123' } }];
    const miss = song('hit');
    assert.deepStrictEqual((await resolveVideo(miss)).videos, ['abc123']);
    assert.strictEqual(apiCalls, 1, 'a miss should search');

    // Only candidates the server issued can be cached, so simulate the client reporting back
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

    console.log(`OK - 4 API calls for 8 lookups`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
