import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import { Room, User, rooms, socketRoomMap, socketUserIdMap } from './roomManager'
import { Song } from './queueManager'
import { resolveVideo } from './api/youtube';
import { spotifyRouter } from './api/spotify';
import { youtubeCache } from './cache/redisCache';

// How many candidates the host will try before giving up. Each costs up to TRIAL_TIMEOUT_MS of
// loading screen, so this bounds the worst case the room ever sits through.
const MAX_TRIALS = 4;

// The day's YouTube budget is enforced in resolveVideo, where it is actually spent. These are the
// social limits: enough for an enthusiastic guest to load up their whole queue at once, not enough
// to flood the room or the broadcast.
const ADD_BURST = 10;            // adds a guest may make back-to-back
const ADD_REFILL_MS = 6_000;     // then one more every 6s
const MAX_SONGS_PER_USER = 10;   // songs one guest can have waiting
const MAX_QUEUE = 100;           // songs in a room
const MAX_USERS = 50;            // guests in a room
const MAX_ROOMS = 500;           // rooms on the server
const MAX_NAME = 24;
const MAX_TITLE = 200;
const MAX_ARTISTS = 5;

const app = express();

// Behind a reverse proxy the socket's remote address is the proxy, so req.ip would be the same for
// everyone and the limiters below would share one bucket. Trust the first hop so req.ip is the real
// client. Set TRUST_PROXY to the number of proxies in front if there is more than one.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// The search endpoint is unauthenticated and every miss spends a Spotify call plus a Redis write,
// so it is the cheapest thing to abuse. /api/rooms is a room-code existence oracle. Both are keyed
// per client IP.
const searchLimiter = rateLimit({
    windowMs: 60_000, limit: 20,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many searches, slow down a moment' },
});
const apiLimiter = rateLimit({
    windowMs: 60_000, limit: 100,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests, slow down a moment' },
});

app.use('/api/spotify/search', searchLimiter);
app.use('/api', apiLimiter);
app.use('/api/spotify', spotifyRouter);
const httpServer = createServer(app);

// Set CLIENT_ORIGIN (comma-separated) to the origin the browser loads the page from. Anything
// public falls outside PRIVATE_ORIGIN below, so leaving it unset in production rejects every
// connection - fail at boot rather than serving a site where nothing works.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? '')
    .split(',').map(o => o.trim()).filter(Boolean);

if (process.env.NODE_ENV === 'production' && !allowedOrigins.length) {
    throw new Error(
        'CLIENT_ORIGIN must list the public origin(s) in production, e.g. https://karaoke.example.com'
    );
}

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

// The HTTP limiters do not see the websocket handshake, so one IP could otherwise open thousands of
// sockets and eat every room and user slot. Cap concurrent sockets per IP.
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP ?? 30);
const socketsByIp = new Map<string, number>();

// socket.io does not apply Express's trust-proxy, so read the forwarded client ourselves.
const clientIp = (socket: { handshake: { address: string; headers: Record<string, any> } }): string => {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
    return socket.handshake.address;
};

io.use((socket, next) => {
    const ip = clientIp(socket);
    const count = socketsByIp.get(ip) ?? 0;
    if (count >= MAX_SOCKETS_PER_IP) return next(new Error('Too many connections'));

    socketsByIp.set(ip, count + 1);
    socket.on('disconnect', () => {
        const left = (socketsByIp.get(ip) ?? 1) - 1;
        if (left <= 0) socketsByIp.delete(ip);
        else socketsByIp.set(ip, left);
    });
    next();
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

// Anything a client sends may be absent, huge, or the wrong type entirely. Names in particular
// are broadcast and rendered, and React throws on a non-string child.
const cleanText = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    return value.trim().slice(0, max) || null;
};

const cleanArtists = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    return value
        .slice(0, MAX_ARTISTS)
        .map(a => cleanText(a, MAX_TITLE))
        .filter((a): a is string => a !== null);
};

const addBuckets = new Map<string, { tokens: number; last: number }>();

const takeAddToken = (socketId: string): boolean => {
    const now = Date.now();
    const bucket = addBuckets.get(socketId) ?? { tokens: ADD_BURST, last: now };
    bucket.tokens = Math.min(ADD_BURST, bucket.tokens + (now - bucket.last) / ADD_REFILL_MS);
    bucket.last = now;
    addBuckets.set(socketId, bucket);

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
};

// Used by the host's own close and by the host vanishing, which are the same thing to a guest.
const closeRoom = (code: string, room: Room): void => {
    io.to(code).emit('host:closeRoom');

    room.users.forEach(user => {
        io.sockets.sockets.get(user.socketId)?.leave(code);
    });

    room.closeRoom();
    socketRoomMap.delete(room.hostId);
    rooms.delete(code);
    console.log(`Closing room ${code}`);
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

    // Guest identity is the socket too. A client-supplied userId is a claim, not a credential -
    // trusting it lets any guest queue songs as someone else, or drop them from the room.
    const guestIn = (code: string): { room: Room; user: User } | undefined => {
        const userId = socketUserIdMap.get(socket.id);
        if (!userId || socketRoomMap.get(socket.id) !== code) return undefined;

        const room = rooms.get(code);
        const user = room?.users.get(userId);
        return room && user ? { room, user } : undefined;
    };

    socket.on('host:createRoom', (_, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};

        // One room per host socket, or a second create orphans the first with no way to reach it.
        const existing = socketRoomMap.get(socket.id);
        if (existing && rooms.get(existing)?.hostId === socket.id) return done({ code: existing });

        // Rooms live until their host leaves, so without a ceiling a loop over this event is an
        // out-of-memory button.
        if (rooms.size >= MAX_ROOMS) return done({ error: 'Server is at capacity' });

        const room = new Room(socket.id);
        const code = room.code;
        rooms.set(code, room);

        console.log(`User ${socket.id} created a room: ${code}`);
        socket.join(code);
        socketRoomMap.set(socket.id, code); // so a host disconnect can find the room to close

        done({ code });
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

        closeRoom(code, room);
        socket.leave(code);
    });

    socket.on('user:joinRoom', ({ code, name }, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};

        const room = rooms.get(code);
        if(!room) return done({ error: 'Room not found' });

        const cleanedName = cleanText(name, MAX_NAME);
        if(!cleanedName) return done({ error: 'Please enter a name' });

        if(room.users.size >= MAX_USERS) return done({ error: 'Room is full' });

        const user = new User(cleanedName, socket.id);
        room.addUser(user);

        socket.join(code);

        socketRoomMap.set(socket.id, code);
        socketUserIdMap.set(socket.id, user.id);

        io.to(code).emit('room:update', Object.fromEntries(room.users));
        console.log(`${cleanedName} joined room ${code}`);

        done({ success: true, userId: user.id });
    });

    socket.on('user:leaveRoom', ({ code }) => {
        const guest = guestIn(code);
        if(!guest) return;

        guest.room.removeUser(guest.user.id);
        io.to(code).emit('room:update', Object.fromEntries(guest.room.users));
        io.to(code).emit('queue:update', guest.room.getQueue());

        socket.leave(code);
    })

    socket.on('user:addSong', async ({ code, title, artists, albumImage }, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};

        const guest = guestIn(code);
        if(!guest) return done({ error: 'User not in room' });
        const { room, user } = guest;

        const cleanedTitle = cleanText(title, MAX_TITLE);
        const cleanedArtists = cleanArtists(artists);
        if (!cleanedTitle || !cleanedArtists) return done({ error: 'Invalid song' });

        // Caps first: they cost nothing and shouldn't spend the guest's burst allowance.
        if (room.getQueue().length >= MAX_QUEUE) {
            return done({ error: 'The queue is full' });
        }

        const mine = room.getQueue().filter(s => s.requestedBy === user.id).length;
        if (mine >= MAX_SONGS_PER_USER) {
            return done({ error: `You can have ${MAX_SONGS_PER_USER} songs waiting at a time` });
        }

        if (!takeAddToken(socket.id)) {
            return done({ error: 'Slow down a moment, then try again' });
        }

        // Built here, not by the client, so the cache key and the search cannot be steered.
        const searchTerm = `${cleanedTitle} ${cleanedArtists[0] ?? ''} karaoke`.slice(0, 200);

        // Already proved unplayable on this room's screen; re-adding it would only cost quota.
        if (room.blocked.has(searchTerm)) {
            return done({ error: 'No karaoke video found for that song' });
        }

        let resolved;
        try {
            resolved = await resolveVideo(searchTerm);
        } catch (error) {
            console.error('Error resolving video:', error);
            return done({ error: 'Video lookup failed' });
        }

        if (resolved.quotaExhausted) {
            return done({ error: 'Song lookups are maxed out for today - already-played songs still work' });
        }

        const candidates = (resolved.videos ?? []).slice(0, MAX_TRIALS);
        if (!resolved.videoId && !candidates.length) {
            return done({ error: 'No karaoke video found for that song' });
        }

        const song: Song = {
            id: uuidv4(),
            title: cleanedTitle,
            artists: cleanedArtists,
            videoId: resolved.videoId ?? null,
            candidates,
            searchTerm,
            requestedBy: user.id,
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

        // Every candidate failed on this room's player, so stop offering it here. Deliberately not
        // written to the shared cache: this verdict is a client's word, and the shared cache is
        // read by every other room. resolveVideo still caches the negatives it observes itself.
        room.blocked.add(song.searchTerm);

        room.removeSong(songId);
        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('user:removeSong', ({ code, songId }) => {
        const guest = guestIn(code);
        if(!guest) return;
        const { room, user } = guest;

        const song = room.getQueue().find(s => s.id === songId);
        if(!song || song.requestedBy !== user.id) return;

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
        addBuckets.delete(socket.id);

        if(!code) return;
        const room = rooms.get(code);
        if(!room) return;

        // A host that closed its tab leaves a room nobody can play, skip or shut down. Without this
        // it sits in memory until the process restarts.
        if(room.hostId === socket.id) return closeRoom(code, room);

        if(userId) {
            room.removeUser(userId);
            io.to(code).emit('room:update', Object.fromEntries(room.users));
            io.to(code).emit('queue:update', room.getQueue());
        }
    });
});

// Serve the built client when it is there, so a deploy is one process instead of two. In dev the
// folder does not exist and Vite serves the app itself.
const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})