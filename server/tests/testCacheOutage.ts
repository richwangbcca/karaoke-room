import 'dotenv/config';
import assert from 'assert';

// A dead Redis must degrade the app to "uncached", never hang it. This reproduces the production
// failure: with REDIS_URL unset the server dialled 127.0.0.1:6379, node-redis retried forever while
// queueing the command, and /api/spotify/search never answered at all.
// Run: pnpm exec ts-node tests/testCacheOutage.ts

const realFetch = globalThis.fetch;
(global as any).fetch = async (target: any) => {
    const url = String(target);
    if (url.includes('accounts.spotify.com')) {
        return { ok: true, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
    }
    if (url.includes('api.spotify.com')) {
        return { ok: true, json: async () => ({ tracks: { items: [] } }) };
    }
    return { ok: true, json: async () => ({ items: [{ id: { videoId: 'good1234567' } }] }) };
};

const PORT = 3983;
const URL = `http://localhost:${PORT}`;

// Nothing listens here. Port 1 is reserved and refuses instantly.
const DEAD_REDIS = 'redis://127.0.0.1:1';

// Generous vs a hung request (which never returns at all) but far above the ~2s connect timeout,
// so this asserts "fails fast" without being flaky on a slow machine.
const MUST_ANSWER_WITHIN_MS = 8_000;

const timed = async (path: string): Promise<{ status: number; ms: number }> => {
    const started = process.hrtime.bigint();
    const res = await realFetch(`${URL}${path}`);
    await res.text();
    return { status: res.status, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};

async function main() {
    process.env.REDIS_URL = DEAD_REDIS;
    process.env.PORT = String(PORT);
    process.env.CLIENT_ORIGIN = URL;
    require('../src/index');
    await new Promise((r) => setTimeout(r, 400));

    // --- a search still answers, and quickly, with the cache unreachable ---
    const first = await timed('/api/spotify/search?q=outage-one');
    assert.strictEqual(first.status, 200, 'search must still succeed with Redis down');
    assert.ok(first.ms < MUST_ANSWER_WITHIN_MS,
        `search must not hang on a dead cache (took ${Math.round(first.ms)}ms)`);

    // --- and the ones after it must not each re-pay the connect timeout ---
    const second = await timed('/api/spotify/search?q=outage-two');
    const third = await timed('/api/spotify/search?q=outage-three');
    assert.strictEqual(second.status, 200);
    assert.strictEqual(third.status, 200);
    assert.ok(second.ms < 1_000 && third.ms < 1_000,
        `once Redis is known down the cache must be skipped, not retried per request ` +
        `(${Math.round(second.ms)}ms, ${Math.round(third.ms)}ms)`);

    // --- the room endpoint, which never touches the cache, is unaffected ---
    const rooms = await timed('/api/rooms/XXXXX');
    assert.strictEqual(rooms.status, 404, 'unrelated endpoints keep working');

    console.log(`OK - cache outage degrades instead of hanging ` +
        `(first ${Math.round(first.ms)}ms, then ${Math.round(second.ms)}/${Math.round(third.ms)}ms)`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
