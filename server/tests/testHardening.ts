import 'dotenv/config';
import assert from 'assert';
import { io as connect, Socket } from 'socket.io-client';
import { useTestDb } from './testDb';

// Covers the HTTP/connection layer: rate limits, the per-IP socket cap, and the security headers.
// These guards live in middleware rather than in the socket handlers, so testAuth never exercises
// them - and a broken one fails open and silently. Run: pnpm exec ts-node tests/testHardening.ts

// Grab the real fetch before the YouTube stub below replaces it - we still need it to drive the
// server's own HTTP endpoints.
const realFetch = globalThis.fetch;

// Answer Spotify's token and search calls too, so /api/spotify/search returns 200 and the rate-limit
// assertions below are measuring the limiter rather than an upstream failure. No network is touched.
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

const PORT = 3985;
const URL = `http://localhost:${PORT}`;

const hit = async (path: string, headers: Record<string, string> = {}): Promise<number> => {
    const res = await realFetch(`${URL}${path}`, { headers });
    return res.status;
};

const countStatuses = async (n: number, path: string, headerFor: (i: number) => Record<string, string>) => {
    let limited = 0, served = 0;
    for (let i = 0; i < n; i++) {
        const status = await hit(path, headerFor(i));
        if (status === 429) limited++; else served++;
    }
    return { served, limited };
};

const openSocket = (headers?: Record<string, string>) => new Promise<Socket | null>((resolve) => {
    const s = connect(URL, {
        transports: ['websocket'],
        reconnection: false,
        ...(headers ? { extraHeaders: headers } : {}),
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', () => resolve(null));
});

async function main() {
    await useTestDb();
    process.env.PORT = String(PORT);
    process.env.MAX_SOCKETS_PER_IP = '5';    // small, so the cap mechanism is cheap to exercise
    process.env.API_RATE_PER_MIN = '100';    // ditto; the search limiter keeps its real default
    delete process.env.TRUST_PROXY;          // exercise the default
    process.env.CLIENT_ORIGIN = URL;         // a plain-http deployment, not whatever .env holds
    const { ROOM_LIMITS } = require('../src/index');
    await new Promise((r) => setTimeout(r, 400));

    // --- the shipped defaults must fit a whole room behind one NAT ---
    // Everyone at a party shares one public IP, so a per-IP cap below room size locks out the last
    // guests to arrive, and a stingy search budget throttles the room while people are picking songs.
    assert.ok(ROOM_LIMITS.DEFAULT_SOCKETS_PER_IP > ROOM_LIMITS.MAX_USERS,
        `the socket cap (${ROOM_LIMITS.DEFAULT_SOCKETS_PER_IP}) must exceed a full room (${ROOM_LIMITS.MAX_USERS})`);
    assert.ok(ROOM_LIMITS.DEFAULT_SEARCH_PER_MIN >= ROOM_LIMITS.MAX_USERS * 4,
        'the search budget must leave a full room several searches each per minute');

    // ...and behave that way. Run this first: a search spends from BOTH limiters, so the /api
    // exhaustion tests below would otherwise poison it.
    const roomBurst = await countStatuses(60, '/api/spotify/search?q=burst', () => ({}));
    assert.strictEqual(roomBurst.limited, 0,
        `a room-sized burst of searches from one IP must not be throttled (${roomBurst.limited} were)`);

    // --- the general /api limiter actually limits ---
    const plain = await countStatuses(130, '/api/rooms/AAAAA', () => ({}));
    assert.ok(plain.limited > 0, 'the /api limiter must reject once the window is spent');
    assert.ok(roomBurst.served + plain.served <= 100,
        `the /api limiter must cap the window at 100 (served ${roomBurst.served + plain.served})`);

    // --- and a forged X-Forwarded-For must not buy a fresh bucket ---
    // With TRUST_PROXY unset (0), the header is not infrastructure we control, so it must be
    // ignored entirely. Trusting it lets one client rotate the header and never be limited.
    const forged = await countStatuses(130, '/api/rooms/AAAAA',
        (i) => ({ 'X-Forwarded-For': `203.0.113.${i % 250}` }));
    assert.ok(forged.limited > 0,
        'a forged X-Forwarded-For must not bypass the rate limiter (all requests were served)');

    // --- the socket cap holds, and also cannot be forged around ---
    const within: Socket[] = [];
    for (let i = 0; i < 5; i++) {
        const s = await openSocket();
        if (s) within.push(s);
    }
    assert.strictEqual(within.length, 5, 'connections within the cap must be accepted');
    assert.strictEqual(await openSocket(), null, 'a connection past the per-IP cap must be refused');

    const spoofed = await openSocket({ 'X-Forwarded-For': '198.51.100.7' });
    assert.strictEqual(spoofed, null,
        'a forged X-Forwarded-For must not bypass the socket cap');

    within[0].close();
    await new Promise((r) => setTimeout(r, 400));
    const afterFree = await openSocket();
    assert.ok(afterFree, 'a slot must free up when a socket disconnects');
    afterFree!.close();
    within.slice(1).forEach((s) => s.close());

    // --- security headers are present, and the CSP does not blanket-allow websockets ---
    const res = await realFetch(`${URL}/api/rooms/AAAAA`);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.ok(res.headers.get('x-content-type-options') === 'nosniff', 'nosniff must be set');
    assert.ok(csp.includes("frame-src"), 'CSP must be present');
    assert.ok(/frame-src[^;]*youtube\.com/.test(csp), 'the YouTube player must stay embeddable');
    assert.ok(/img-src[^;]*scdn\.co/.test(csp), 'Spotify album art must stay loadable');
    const connectSrc = (csp.match(/connect-src([^;]*)/) ?? [])[1] ?? '';
    assert.ok(!/\sws:|\swss:/.test(connectSrc),
        `connect-src must not blanket-allow ws:/wss: to any host (got "${connectSrc.trim()}")`);

    // --- HTTPS-only headers must not be asserted on a plain-HTTP deployment ---
    // upgrade-insecure-requests rewrites same-origin asset URLs to https://, so on a plain-HTTP
    // host the page fetches its own scripts over TLS that nothing serves and renders blank. This
    // cannot be caught on localhost: it is exempt from the upgrade, so the bug only appears once
    // deployed to a real hostname. CLIENT_ORIGIN here is http, so neither header may appear.
    assert.ok(!/upgrade-insecure-requests/i.test(csp),
        'upgrade-insecure-requests must be off when CLIENT_ORIGIN is not https - it blanks the page');
    assert.strictEqual(res.headers.get('strict-transport-security'), null,
        'HSTS must not be sent on a plain-HTTP deployment');

    console.log('OK - rate limits, socket cap, forged-XFF resistance and security headers hold');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
