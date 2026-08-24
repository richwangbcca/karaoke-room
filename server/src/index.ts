import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

import { Room, User, rooms, socketRoomMap, socketUserIdMap } from './roomManager'
import { Song } from './queueManager'
import { resolveVideo } from './api/youtube';
import { spotifyRouter } from './api/spotify';
import { youtubeCache, NEGATIVE_TTL } from './cache/redisCache';

// How many candidates the host will try before giving up. Each costs up to TRIAL_TIMEOUT_MS of
// loading screen, so this bounds the worst case the room ever sits through.
const MAX_TRIALS = 4;

const app = express();
app.use('/api/spotify', spotifyRouter);
const httpServer = createServer(app);

// Same-origin by default - the client is served through a proxy and connects with a bare io().
// Set CLIENT_ORIGIN (comma-separated) only if the frontend is hosted somewhere else.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? '')
    .split(',').map(o => o.trim()).filter(Boolean);

// Loopback and LAN origins. Comparing Origin against the Host header does not work: both the Vite
// dev proxy and a production reverse proxy rewrite Host to the backend, and neither forwards
// x-forwarded-host, so every browser connection would be rejected.
const PRIVATE_ORIGIN = /^(localhost|\[?::1\]?|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.+\.local)$/;

// CORS would not stop a page connecting with transports: ['websocket'], so the check lives here.
// Guests on the same network are the intended users; a public site is not.
const originAllowed = (req: { headers: Record<string, any> }): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser client; an origin check cannot help there
    if (allowedOrigins.includes(origin)) return true;
    try {
        return PRIVATE_ORIGIN.test(new URL(origin).hostname);
    } catch {
        return false;
    }
};

const io = new Server(httpServer, {
    cors: { origin: allowedOrigins.length ? allowedOrigins : true },
    allowRequest: (req, callback) => callback(null, originAllowed(req as any)),
});

// albumImage is rendered as an <img src> for everyone in the room, so it must stay on Spotify's CDN
const SPOTIFY_IMAGE_HOSTS = ['scdn.co', 'spotifycdn.com'];

const spotifyImageOrNull = (url: unknown): string | null => {
    if (typeof url !== 'string') return null;
    try {
        const { protocol, hostname } = new URL(url);
        const ok = protocol === 'https:' &&
            SPOTIFY_IMAGE_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
        return ok ? url : null;
    } catch {
        return null;
    }
};

app.get('/api/rooms/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  if (rooms.has(roomCode)) {
    return res.status(200).json({ exists: true });
  }
  res.status(404).json({ error: 'Room not found' });
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Knowing the room code is not authorization; host actions are tied to the host's socket.
    // Host identity is the socket, so a host reconnect orphans the room. fixing it needs a persistent 
    // host token.
    const hostRoom = (code: string): Room | undefined => {
        const room = rooms.get(code);
        return room && room.hostId === socket.id ? room : undefined;
    };

    socket.on('host:createRoom', (_, callback) => {
        const room = new Room(socket.id);
        const code = room.code;
        rooms.set(code, room);

        console.log(`User ${socket.id} created a room: ${code}`);
        socket.join(code);

        callback({ code });
    });

    socket.on('host:skipSong', ({ code }) => {
        const room = hostRoom(code);
        if(!room) return;

        const success = room.skipSong();
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('host:removeSong', ({ code, songId }) => {
        const room = hostRoom(code);
        if(!room) return;

        const success = room.removeSong(songId);
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('host:removeUser', ({ code, userId }) => {
        const room = hostRoom(code);
        if(!room) return;

        const user = room.users.get(userId);
        if(!user) return;

        const success = room.removeUser(userId);
        if(!success) return;

        const toRemove = io.sockets.sockets.get(user.socketId);
        if (toRemove) {
            toRemove.emit('host:removeUser');
            toRemove.leave(code);
        }

        io.to(code).emit('room:update', Object.fromEntries(room.users));
    });

    socket.on('host:closeRoom', ({ code }) => {
        const room = hostRoom(code);
        if(!room) return;

        io.to(code).emit('host:closeRoom');

        room.users.forEach(user => {
            const toRemove = io.sockets.sockets.get(user.socketId);
            if (toRemove) toRemove.leave(code);
        });

        room.closeRoom();
        rooms.delete(code);

        socket.leave(code);
        console.log(`Closing room ${code}`);
    });

    socket.on('user:joinRoom', ({ code, name }, callback) => {
        const room = rooms.get(code);
        if(!room) return callback({ error: 'Room not found' });

        const user = new User(name, socket.id);
        room.addUser(user);

        socket.join(code);

        socketRoomMap.set(socket.id, code);
        socketUserIdMap.set(socket.id, user.id);

        io.to(code).emit('room:update', Object.fromEntries(room.users));
        console.log(`${name} joined room ${code}`);

        callback({ success: true, userId: user.id });
    });

    socket.on('user:leaveRoom', ({ code, userId }) => {
        const room = rooms.get(code);
        if(!room) return;

        room.removeUser(userId);
        io.to(code).emit('room:update', Object.fromEntries(room.users));

        socket.leave(code);
    })

    socket.on('user:addSong', async ({ code, userId, title, artists, albumImage }, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};

        const room = rooms.get(code);
        if(!room) return done({ error: 'Room not found' });

        const user = room.users.get(userId);
        if(!user) return done({ error: 'User not in room' });

        if (typeof title !== 'string' || !title.trim() || !Array.isArray(artists)) {
            return done({ error: 'Invalid song' });
        }

        // Built here, not by the client, so the cache key and the search cannot be steered.
        const searchTerm = `${title} ${artists[0] ?? ''} karaoke`.slice(0, 200);

        let resolved;
        try {
            resolved = await resolveVideo(searchTerm);
        } catch (error) {
            console.error('Error resolving video:', error);
            return done({ error: 'Video lookup failed' });
        }

        const candidates = (resolved.videos ?? []).slice(0, MAX_TRIALS);
        if (!resolved.videoId && !candidates.length) {
            return done({ error: 'No karaoke video found for that song' });
        }

        const song: Song = {
            id: uuidv4(),
            title,
            artists,
            videoId: resolved.videoId ?? null,
            candidates,
            searchTerm,
            requestedBy: userId,
            singer: user.name,
            albumImage: spotifyImageOrNull(albumImage)
        };

        if (!user.addSong(song)) return done({ error: 'Could not add song' });

        io.to(code).emit('queue:update', room.getQueue());
        done({ ok: true });
    });

    // The host is the only client that actually plays the video, so it is the only one that can
    // tell whether it works. A guest's phone cannot - mobile browsers refuse to play hidden video.
    socket.on('host:videoResolved', async ({ code, songId, videoId }) => {
        const room = hostRoom(code);
        if(!room) return;

        const song = room.getQueue().find(s => s.id === songId);
        if(!song || !song.candidates.includes(videoId)) return;

        song.videoId = videoId;
        await youtubeCache.set(song.searchTerm, videoId);

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('host:videoFailed', async ({ code, songId }) => {
        const room = hostRoom(code);
        if(!room) return;

        const song = room.getQueue().find(s => s.id === songId);
        if(!song) return;

        // Every candidate failed on a real player, so this is a genuine "no playable video"
        await youtubeCache.set(song.searchTerm, null, NEGATIVE_TTL);

        room.removeSong(songId);
        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('user:removeSong', ({ code, songId }) => {
        const room = rooms.get(code);
        if(!room) return;

        const userId = socketUserIdMap.get(socket.id);
        if(!userId) return;

        const song = room.getQueue().find(s => s.id === songId);
        if(!song || song.requestedBy !== userId) return;

        const success = room.removeSong(songId);
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        const code = socketRoomMap.get(socket.id);
        const userId = socketUserIdMap.get(socket.id);

        socketRoomMap.delete(socket.id);
        socketUserIdMap.delete(socket.id);

        if(!code) return;
        const room = rooms.get(code);

        if(room && userId) {
            room.removeUser(userId);
            io.to(code).emit('room:update', Object.fromEntries(room.users));
            io.to(code).emit('queue:update', room.getQueue());
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})