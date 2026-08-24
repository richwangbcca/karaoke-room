import 'dotenv/config';
import assert from 'assert';
import { io as connect, Socket } from 'socket.io-client';
import { useTestDb } from './testDb';

// Stub YouTube before index.ts loads so no quota is spent.
(global as any).fetch = async () => ({
    ok: true,
    json: async () => ({ items: [{ id: { videoId: 'good1234567' } }] })
});

const URL = 'http://localhost:3999';
const open = () => new Promise<Socket>((resolve) => {
    const s = connect(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
});
const ask = <T>(s: Socket, event: string, payload: any) =>
    new Promise<T>((resolve) => s.emit(event, payload, resolve));
const settle = () => new Promise((r) => setTimeout(r, 150));

async function main() {
    await useTestDb();
    process.env.PORT = '3999';
    require('../src/index');
    await settle();

    const host = await open();
    const guest = await open();
    const outsider = await open();

    const { code } = await ask<{ code: string }>(host, 'host:createRoom', {});
    const { userId } = await ask<{ userId: string }>(guest, 'user:joinRoom', { code, name: 'guest' });

    let queue: any[] = [];
    host.on('queue:update', (q: any[]) => { queue = q; });

    // --- the guest cannot choose the video at all; the server resolves it ---
    const added = await ask<{ ok?: boolean; error?: string }>(guest, 'user:addSong', {
        code, userId, title: 'ok', artists: ['x'],
        albumImage: 'https://i.scdn.co/image/abc',
        videoId: 'SHOCKVIDEO1'  // ignored - the server does its own lookup
    });
    assert.strictEqual(added.ok, true, 'a valid song must be accepted');
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].videoId, null, 'unproven video must not be playable yet');
    assert.deepStrictEqual(queue[0].candidates, ['good1234567'], 'server picks the candidates');
    assert.strictEqual(queue[0].albumImage, 'https://i.scdn.co/image/abc', 'Spotify art must survive');

    // --- albumImage cannot point off Spotify's CDN ---
    for (const bad of [
        'https://evil.com/pixel.gif',       // tracking pixel aimed at every guest
        'http://i.scdn.co/image/abc',       // downgraded to http
        'https://evil-scdn.co/pixel.gif',   // suffix that only looks like scdn.co
        'javascript:alert(1)',
        'not a url'
    ]) {
        await ask(guest, 'user:addSong', { code, userId, title: bad, artists: ['x'], albumImage: bad });
        const song = queue.find((s: any) => s.title === bad);
        assert.ok(song, `song should still queue for ${bad}`);
        assert.strictEqual(song.albumImage, null, `albumImage must be dropped for ${bad}`);
    }

    // --- only the host can declare a video playable, and only from the offered candidates ---
    const songId = queue[0].id;
    guest.emit('host:videoResolved', { code, songId, videoId: 'good1234567' });
    await settle();
    assert.strictEqual(queue[0].videoId, null, 'a guest must not resolve a video');

    host.emit('host:videoResolved', { code, songId, videoId: 'SHOCKVIDEO1' });
    await settle();
    assert.strictEqual(queue[0].videoId, null, 'even the host cannot inject a non-candidate');

    host.emit('host:videoResolved', { code, songId, videoId: 'good1234567' });
    await settle();
    assert.strictEqual(queue[0].videoId, 'good1234567', 'the host proved it plays');

    // --- only the host can blacklist a song, and only after its player exhausted the candidates ---
    const duddy = queue[queue.length - 1];
    guest.emit('host:videoFailed', { code, songId: duddy.id });
    await settle();
    assert.ok(queue.find((s: any) => s.id === duddy.id), 'a guest must not blacklist a song');

    host.emit('host:videoFailed', { code, songId: duddy.id });
    await settle();
    assert.ok(!queue.find((s: any) => s.id === duddy.id), 'the host drops an unplayable song');

    // A failure is one client's word, so it must not reach a cache every other room reads.
    const { youtubeCache } = require('../src/cache/redisCache');
    assert.strictEqual(await youtubeCache.get(duddy.searchTerm), undefined,
        'a host verdict must not be written to the shared cache');

    const readded = await ask<any>(guest, 'user:addSong', {
        code, userId, title: duddy.title, artists: duddy.artists
    });
    assert.ok(readded.error, 'the room that proved it unplayable should stop offering it');

    // ...but only that room. Another host must not inherit a stranger's blacklist.
    const host2 = await open();
    const guest2 = await open();
    const { code: code2 } = await ask<{ code: string }>(host2, 'host:createRoom', {});
    await ask(guest2, 'user:joinRoom', { code: code2, name: 'elsewhere' });
    const elsewhere = await ask<any>(guest2, 'user:addSong', {
        code: code2, title: duddy.title, artists: duddy.artists
    });
    assert.strictEqual(elsewhere.ok, true, 'one room must not blacklist a song for every other room');
    host2.close();
    guest2.close();

    // Reset to a single song for the host-guard checks below
    queue.slice(1).forEach((s: any) => host.emit('host:removeSong', { code, songId: s.id }));
    await settle();
    assert.strictEqual(queue.length, 1, 'host cleanup should leave one song');

    // --- host actions require being the host, not just knowing the code ---
    guest.emit('host:skipSong', { code });
    outsider.emit('host:skipSong', { code });
    await settle();
    assert.strictEqual(queue.length, 1, 'non-hosts must not skip songs');

    guest.emit('host:removeSong', { code, songId: queue[0].id });
    await settle();
    assert.strictEqual(queue.length, 1, 'non-hosts must not remove songs');

    let kicked = false;
    guest.on('host:removeUser', () => { kicked = true; });
    outsider.emit('host:removeUser', { code, userId });
    await settle();
    assert.strictEqual(kicked, false, 'non-hosts must not kick users');

    let closed = false;
    guest.on('host:closeRoom', () => { closed = true; });
    outsider.emit('host:closeRoom', { code });
    await settle();
    assert.strictEqual(closed, false, 'non-hosts must not close the room');

    // --- a guest cannot act as another guest ---
    const attacker = await open();
    const att = await ask<{ userId: string }>(attacker, 'user:joinRoom', { code, name: 'attacker' });

    await ask(attacker, 'user:addSong', {
        code, userId, title: 'impersonated', artists: ['x'] // userId is the victim's
    });
    await settle();
    const spoofed = queue.find((s: any) => s.title === 'impersonated');
    assert.ok(spoofed, 'the song should still queue');
    assert.strictEqual(spoofed.requestedBy, att.userId, 'a song must be credited to the socket that sent it');
    assert.strictEqual(spoofed.singer, 'attacker', 'a guest must not queue songs under another name');

    attacker.emit('user:removeSong', { code, songId: queue[0].id }); // not the attacker's song
    await settle();
    assert.ok(queue.find((s: any) => s.id === spoofed.id), 'sanity: the queue is still live');
    assert.strictEqual(queue[0].requestedBy, userId, "a guest must not remove another guest's song");

    attacker.emit('user:leaveRoom', { code, userId }); // the victim's id again
    await settle();
    const rooms = require('../src/roomManager').rooms;
    assert.ok(rooms.get(code).users.has(userId), 'a guest must not remove another guest from the room');
    assert.ok(!rooms.get(code).users.has(att.userId), 'leaving must remove the sender');
    attacker.close();

    // --- names are not trusted ---
    for (const bad of [{ evil: 1 }, '', '   ', 42, null]) {
        const res = await ask<any>(await open(), 'user:joinRoom', { code, name: bad });
        assert.ok(res.error, `a name of ${JSON.stringify(bad)} must be rejected`);
    }
    const long = await open();
    await ask(long, 'user:joinRoom', { code, name: 'A'.repeat(10_000) });
    await settle();
    const names = [...rooms.get(code).users.values()].map((u: any) => u.name);
    assert.ok(names.every((n: string) => typeof n === 'string' && n.length <= 24),
        'every stored name must be a string the host view can render');
    long.close();

    // --- one guest cannot flood the queue ---
    const flooder = await open();
    const f = await ask<{ userId: string }>(flooder, 'user:joinRoom', { code, name: 'flooder' });
    const outcomes = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
            ask<any>(flooder, 'user:addSong', { code, title: `flood-${i}`, artists: ['x'] }))
    );
    const accepted = outcomes.filter(r => r.ok).length;
    assert.ok(accepted <= 10, `a guest must not queue 40 songs at once (accepted ${accepted})`);
    assert.ok(outcomes.some(r => r.error), 'the guest must be told why');
    const flooded = queue.filter((s: any) => s.requestedBy === f.userId).length;
    assert.strictEqual(flooded, accepted, 'only the accepted songs should be queued');
    flooder.close();

    // --- the real host still works ---
    queue.slice(1).forEach((s: any) => host.emit('host:removeSong', { code, songId: s.id }));
    await settle();
    host.emit('host:skipSong', { code });
    await settle();
    assert.strictEqual(queue.length, 0, 'the host must still be able to skip');

    host.emit('host:closeRoom', { code });
    await settle();
    assert.strictEqual(closed, true, 'the host must still be able to close the room');

    // --- a room does not outlive its host ---
    const ghost = await open();
    const { code: ghostCode } = await ask<{ code: string }>(ghost, 'host:createRoom', {});
    const stranded = await open();
    let evicted = false;
    stranded.on('host:closeRoom', () => { evicted = true; });
    await ask(stranded, 'user:joinRoom', { code: ghostCode, name: 'stranded' });

    assert.strictEqual((await ask<any>(ghost, 'host:createRoom', {})).code, ghostCode,
        'a second create from one host socket must not orphan the first room');

    ghost.close();
    await settle();
    assert.ok(!rooms.has(ghostCode), 'a room must not outlive the host that owns it');
    assert.strictEqual(evicted, true, 'guests must be told the room is gone');
    stranded.close();

    // --- origin checks: same-origin in, everything else out ---
    const connectsWithOrigin = (origin: string) => new Promise<boolean>((resolve) => {
        const s = connect(URL, {
            transports: ['websocket'],
            extraHeaders: { Origin: origin },
            reconnection: false
        });
        s.on('connect', () => { s.close(); resolve(true); });
        s.on('connect_error', () => { s.close(); resolve(false); });
    });

    // Proves the rejections below are the origin check, not a blanket failure.
    // Note the Host header here is localhost:3999 while Origin is not - that is exactly what a
    // proxy produces, since Vite and nginx both rewrite Host to the backend.
    assert.strictEqual(await connectsWithOrigin('http://localhost:5173'), true,
        'the dev server must connect');
    assert.strictEqual(await connectsWithOrigin('http://192.168.1.50:5173'), true,
        'a phone on the LAN must connect');
    assert.strictEqual(await connectsWithOrigin('http://10.0.0.4:5173'), true,
        'other private ranges must connect');

    assert.strictEqual(await connectsWithOrigin('https://evil.example'), false,
        'a public Origin must be rejected');
    assert.strictEqual(await connectsWithOrigin('http://192.168.1.50.evil.com'), false,
        'a public host that merely looks private must be rejected');

    console.log('OK - host, guest identity, input, flood, room lifetime and origin guards hold');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
