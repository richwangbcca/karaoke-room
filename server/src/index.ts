import express from 'express';          // HTTP web framework
import { createServer } from 'http';    // turns Express app to raw HTTP server
import { Server } from 'socket.io';     // core Socket.IO server instance
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import axios from 'axios';

import { Song } from './structures'
import { createRoom, joinRoom, getRoom } from './roomManager'
import { addSong, getRoundRobinQueue } from './queueManager'

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

app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') {
        res.status(400).send({error: 'Missing query'});
        return;
    }

    try {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q,
                type: 'video',
                key: process.env.YOUTUBE_API_KEY,
                maxResults: 5,
            },
        });

        const results = response.data.items.map((item: any) => ({
            title: item.snippet.title,
            videoId: item.id.videoId,
            thumbnail: item.snippet.thumbnails.default.url,
        }));

        res.send(results);
    } catch (err) {
        res.status(500).send({ error: 'Search failed'});
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`)
})