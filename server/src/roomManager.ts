import { v4 as uuidv4 } from 'uuid';
import { Queue, Song } from './queueManager'

export const rooms = new Map<string, Room>();

export class Room {
    code: string;
    hostId: string;
    users: Map<string, User>;
    queue: Queue;

    constructor(hostSocketId: string) {
        this.code = generateRoomCode();
        this.hostId = hostSocketId;
        this.users = new Map();
        this.queue = new Queue();
    }

    addUser(user: User): boolean {
        this.users.set(user.id, user);

        return true;
    }

    removeUser(userId: string): boolean {
        const user = this.users.get(userId);
        if(!user) return false;

        this.queue.removeUser(user.id);
        this.users.delete(user.id)

        socketRoomMap.delete(user.socketId);
        socketUserIdMap.delete(user.socketId);

        return true;
    }

    getQueue(): Song[] {
        return this.queue.queue;
    }

    skipSong(): boolean {
        const song = this.queue.skipSong();
        if(!song) return false;

        return true;
    }

    removeSong(songId: string ): boolean {
        const removedSong = this.queue.removeSong(songId);

        if(!removedSong) return false;

        return true;
    }
}

export const socketRoomMap = new Map<string, string>();    // User socket id : room code
export const socketUserIdMap = new Map<string, string>();  // User socked id : user id

export class User {
    id: string;
    name: string;
    socketId: string;

    constructor(name: string, userSocketId: string) {
        this.id = uuidv4();
        this.name = name;
        this.socketId = userSocketId;
    }

    addSong(song: Song): boolean {
        const code = this.getRoom();
        if(!code) return false;

        const room = rooms.get(code);
        if(!room) return false;
        room.queue.addSong(song);

        return true;
    }

    removeSong(songId: string): boolean {
        const code = this.getRoom();
        if(!code) return false;

        const room = rooms.get(code);
        if(!room) return false;
        room.queue.removeSong(songId);

        return true;
    }

    getRoom(): string {
        const code = socketRoomMap.get(this.socketId);
        if(!code) return "";

        return code;
    }
}


function generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    let code = Array.from ({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    while(rooms.has(code)) {
        code = Array.from ({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    return code;
}
