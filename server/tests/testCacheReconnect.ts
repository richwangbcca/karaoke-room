import 'dotenv/config';
import assert from 'assert';
import { spawnSync } from 'child_process';

// A managed Redis (Upstash, which is what `fly redis create` provisions) closes connections that
// have gone idle. This app idles most of the day, so that happens routinely in production and must
// be a non-event: the next cache call has to reconnect on its own, without a miss or a stall.
// Needs redis-server on PATH. Run: pnpm exec ts-node tests/testCacheReconnect.ts

const PORT = 6398;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cli = (args: string[]) => spawnSync('redis-cli', ['-p', String(PORT), ...args], { encoding: 'utf8' });

async function main() {
    spawnSync('redis-server', ['--port', String(PORT), '--daemonize', 'yes', '--save', ''], { encoding: 'utf8' });
    await wait(600);
    process.env.REDIS_URL = `redis://127.0.0.1:${PORT}`;
    const { spotifyCache } = require('../src/cache/redisCache');

    await spotifyCache.set('reconnect', [{ trackId: 'a' }]);
    assert.ok(await spotifyCache.get('reconnect'), 'sanity: the cache serves a hit while healthy');

    // Exactly what an idle timeout does: drop the client's connection, leave the server running.
    cli(['client', 'kill', 'type', 'normal']);
    await wait(300);

    const started = Date.now();
    const afterKill = await spotifyCache.get('reconnect');
    const elapsed = Date.now() - started;

    assert.ok(afterKill, 'a dropped idle connection must reconnect, not turn into a cache miss');
    assert.ok(elapsed < 1_000, `reconnect must be transparent, took ${elapsed}ms`);
    assert.ok(await spotifyCache.get('reconnect'), 'and stay usable afterwards');

    cli(['shutdown', 'nosave']);
    console.log(`OK - an idle disconnect reconnects transparently (${elapsed}ms, no miss)`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    spawnSync('redis-cli', ['-p', String(PORT), 'shutdown', 'nosave']);
    process.exit(1);
});
