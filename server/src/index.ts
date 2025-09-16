import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

import { Room, User, rooms, socketRoomMap, socketUserIdMap } from './roomManager'
import { Song } from './queueManager'
import { youtubeRouter } from './api/youtube';
import { spotifyRouter } from './api/spotify';
import { youtubeCache } from './cache/youtubeCache';

const app = express();
app.use('/api/youtube', youtubeRouter);
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

    socket.on('host:createRoom', (_, callback) => {
        const room = new Room(socket.id);
        const code = room.code;
        rooms.set(code, room);

        console.log(`User ${socket.id} created a room: ${code}`);
        socket.join(code);

        callback({ code });
    });

    socket.on('host:skipSong', ({ code }) => {
        const room = rooms.get(code);
        if(!room) return;

        const success = room.skipSong();
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('host:removeSong', ({ code, songId }) => {
        const room = rooms.get(code);
        if(!room) return;

        const success = room.removeSong(songId);
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('host:removeUser', ({ code, userId }) => {
        const room = rooms.get(code);
        if(!room) return;
        
        const user = room.users.get(userId);
        if(!user) return;

        const success = room.removeUser(userId);
        if(!success) return;

        io.to(user.socketId).emit('host:removeUser');
        
        const toRemove = io.sockets.sockets.get(user.socketId);
        if (toRemove) toRemove.leave(code);

        io.to(code).emit('room:update', Object.fromEntries(room.users));
    });

    socket.on('host:closeRoom', ({ code }) => {
        const room = rooms.get(code);
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
        if(!room) return;
        
        const user = new User(name, socket.id);
        const success = room.addUser(user);
        if (!success) {
            callback({ error: 'Room not found'});
            return;
        }

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

        const success = room.removeSong(songId);
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
    });

    socket.on('user:checkCache', async ({ searchTerm }, callback) => {
        try {
            const cachedVideoId = await youtubeCache.get(searchTerm);
            callback({ videoId: cachedVideoId });
        } catch (error) {
            console.error('Error checking cache:', error);
            callback({ videoId: null });
        }
    });

    socket.on('user:cacheVideo', async ({ searchTerm, videoId }) => {
        try {
            await youtubeCache.set(searchTerm, videoId);
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
            io.to(code).emit('room:update', room.users);
            io.to(code).emit('queue:update', room.getQueue());
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})