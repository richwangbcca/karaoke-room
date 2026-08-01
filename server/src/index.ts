import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

import { Room, User, rooms, socketRoomMap, socketUserIdMap } from './roomManager'
import { Song } from './queueManager'
import { resolveVideo } from './api/youtube';
import { spotifyRouter } from './api/spotify';
import { youtubeCache, normalizeKey, NEGATIVE_TTL } from './cache/redisCache';

const app = express();
app.use('/api/spotify', spotifyRouter);
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { origin: '*' },
});

app.get('/api/rooms/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  if (rooms.has(roomCode)) {
    return res.status(200).json({ exists: true });
  }
  res.status(404).json({ error: 'Room not found' });
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    const issued = new Map<string, string[]>();

    // Video ids this socket was actually offered, so a client can't queue arbitrary videos
    // onto the host's screen by skipping the search flow.
    const vouched = new Set<string>();

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

    socket.on('user:addSong', ({ code, userId, title, artists, videoId, albumImage }) => {
        const room = rooms.get(code);
        if(!room) return;

        const user = room.users.get(userId);
        if(!user) return;

        // Only videos this socket was offered by user:resolveVideo can be queued
        if(!vouched.has(videoId)) {
            console.warn(`Rejected unvouched videoId ${videoId} from ${socket.id}`);
            return;
        }

        const song: Song = {
            id: uuidv4(),
            title,
            artists,
            videoId,
            requestedBy: userId,
            singer: user.name,
            albumImage
        };

        const success = user.addSong(song);
        if (!success) {
            console.log("addSong failed");
            return;
        }

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

    socket.on('user:resolveVideo', async ({ searchTerm, skipCache }, callback) => {
        try {
            const result = await resolveVideo(searchTerm, Boolean(skipCache));

            if (result.videos) {
                issued.set(normalizeKey(searchTerm), result.videos);
                result.videos.forEach(v => vouched.add(v));
            }
            if (result.videoId) vouched.add(result.videoId);

            callback(result);
        } catch (error) {
            console.error('Error resolving video:', error);
            callback({ error: 'Video lookup failed' });
        }
    });

    // Only the client can tell whether a video actually plays, so it reports the winner back
    // (or null if none of the candidates worked). Restricted to candidates we handed out.
    socket.on('user:cacheVideo', async ({ searchTerm, videoId }) => {
        try {
            const key = normalizeKey(searchTerm);
            const candidates = issued.get(key);
            if (!candidates) return;

            if (videoId === null) {
                await youtubeCache.set(key, null, NEGATIVE_TTL);
            } else if (candidates.includes(videoId)) {
                await youtubeCache.set(key, videoId);
            } else {
                return;
            }

            issued.delete(key);
        } catch (error) {
            console.error('Error caching video:', error);
        }
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