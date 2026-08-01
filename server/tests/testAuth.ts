import 'dotenv/config';
import assert from 'assert';
import { io as connect, Socket } from 'socket.io-client';

// Stub YouTube before index.ts loads so no quota is spent.
(global as any).fetch = async () => ({
    ok: true,
    json: async () => ({ items: [{ id: { videoId: 'good1234567' } }] })
});

process.env.PORT = '3999';
require('../src/index');

const URL = 'http://localhost:3999';
const open = () => new Promise<Socket>((resolve) => {
    const s = connect(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
});
const ask = <T>(s: Socket, event: string, payload: any) =>
    new Promise<T>((resolve) => s.emit(event, payload, resolve));
const settle = () => new Promise((r) => setTimeout(r, 150));

async function main() {
    const host = await open();
    const guest = await open();
    const outsider = await open();

    const { code } = await ask<{ code: string }>(host, 'host:createRoom', {});
    const { userId } = await ask<{ userId: string }>(guest, 'user:joinRoom', { code, name: 'guest' });

    let queue: any[] = [];
    host.on('queue:update', (q: any[]) => { queue = q; });

    // --- addSong is limited to videos the server offered this socket ---
    const resolved = await ask<{ videos?: string[] }>(guest, 'user:resolveVideo', {
        searchTerm: 'a song karaoke'
    });
    assert.deepStrictEqual(resolved.videos, ['good1234567']);

    guest.emit('user:addSong', { code, userId, title: 'evil', artists: ['x'], videoId: 'SHOCKVIDEO1' });
    await settle();
    assert.strictEqual(queue.length, 0, 'an unvouched videoId must be rejected');

    guest.emit('user:addSong', { code, userId, title: 'ok', artists: ['x'], videoId: 'good1234567' });
    await settle();
    assert.strictEqual(queue.length, 1, 'a vouched videoId must be accepted');

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

    // --- the real host still works ---
    host.emit('host:skipSong', { code });
    await settle();
    assert.strictEqual(queue.length, 0, 'the host must still be able to skip');

    host.emit('host:closeRoom', { code });
    await settle();
    assert.strictEqual(closed, true, 'the host must still be able to close the room');

    console.log('OK - host guard and addSong guard hold');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
