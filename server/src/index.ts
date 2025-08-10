import express from 'express';          // HTTP web framework
import { createServer } from 'http';    // turns Express app to raw HTTP server
import { Server } from 'socket.io';     // core Socket.IO server instance
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

import { Room, User, rooms, socketRoomMap, socketUserIdMap } from './roomManager'
import { Song } from './queueManager'
import { youtubeRouter } from './api/youtube';

const app = express();
app.use('/api/youtube', youtubeRouter);
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

    socket.on('host:skipSong', ({ code }, callback) => {
        const room = rooms.get(code);
        if(!room) return;

        const success = room.skipSong();
        if(!success) return;

        io.to(code).emit('queue:update', room.getQueue());
        callback({ success: true });
    })

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

        io.to(code).emit('room:update', room.userNames);
        console.log(`${name} joined room ${code}`);

        callback({ success: true, userId: user.id });
        }
    );

    socket.on('user:addSong', ({ code, userId, title, videoId }, callback) => {
        const room = rooms.get(code);
        if(!room) return;

        const user = room.users.get(userId);
        if(!user) return;

        const song: Song = {
            id: uuidv4(),
            title,
            videoId,
            requestedBy: userId,
            singer: user.name
        };

        const success = user.addSong(song);
        if (!success) {
            callback({ error: "Invalid room or user" });
            return;
        }

        io.to(code).emit('queue:update', room.getQueue());
        callback({ success: true });
    })

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
            io.to(code).emit('room:update', room.userNames);
            io.to(code).emit('queue:update', room.getQueue());
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})