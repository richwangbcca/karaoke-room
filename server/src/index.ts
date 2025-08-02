import express from 'express';          // HTTP web framework
import { createServer } from 'http';    // turns Express app to raw HTTP server
import { Server } from 'socket.io';     // core Socket.IO server instance
import dotenv from 'dotenv';

import { Song } from './structures'
import { createRoom, joinRoom, getRoom } from './roomManager'
import { addSong, getRoundRobinQueue } from './queueManager'
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: '*'
    },
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('host:createRoom', (_, callback) => {
        const code = createRoom(socket.id);
        console.log(`User ${socket.id} created a room: ${code}`);
        callback({ code });
    });

    socket.on('user:joinRoom', ({ code, name }, callback) => {
        const id = uuidv4();
        const success = joinRoom(code, {
            id,
            name,
            socketId: socket.id,
            queue: [],
        });
        
        if (!success) {
            callback({ error: 'Room not found'});
        }

        socket.join(code);
        console.log(`${name} joined room ${code}`);
        
        callback({ success: true, userId: id });
        }
    );

    socket.on('user:addSong', ({ code, userId, title, videoId }, callback) => {
        const song: Song = {
            id: uuidv4(),
            title,
            videoId,
            requestedBy: userId,
        };
        const success = addSong(code, userId, song);

        if (!success) {
            callback({ error: "Invalid room or user" });
            return;
        }

        const queue = getRoundRobinQueue(code);
        io.to(code).emit('queue.update', queue);
        callback({ success: true });
    })

    socket.on('disconnect', () => {
        console.log('User disconneced:', socket.id);
    });
});


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})