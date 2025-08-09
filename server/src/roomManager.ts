import { v4 as uuidv4 } from 'uuid';
import { Queue, Song } from './queueManager'

export const rooms = new Map<string, Room>();

export class Room {
    code: string;
    hostId: string;
    users: Map<string, User>;
    userNames: string[];
    queue: Queue;

    constructor(hostSocketId: string) {
        this.code = generateRoomCode();
        this.hostId = hostSocketId;
        this.users = new Map();
        this.userNames = [],
        this.queue = new Queue();
    }

    addUser(user: User): boolean {
        this.users.set(user.id, user);
        this.userNames.push(user.name);

        return true;
    }

    removeUser(userId: string): boolean {
        const user = this.users.get(userId);
        if(!user) return false;

        const index = this.userNames.indexOf(user.name);
        if (index !== -1) {
            this.userNames.splice(index, 1);
        }

        this.queue.removeUser(user.id);
        this.users.delete(user.id)

        return true;
    }

    getQueue(): Song[] {
        return this.queue.queue;
    }

    skipSong(): boolean {
        const song = this.queue.skipSong();
        if(!song) return false;

        const user = this.users.get(song.requestedBy);
        if(user) user.queue.skipSong();

        return true;
    }
}

export const socketRoomMap = new Map<string, string>();    // User socket id : room code
export const socketUserIdMap = new Map<string, string>();  // User socked id : user id

export class User {
    id: string;
    name: string;
    socketId: string;
    queue: Queue;

    constructor(name: string, userSocketId: string) {
        this.id = uuidv4();
        this.name = name;
        this.socketId = userSocketId;
        this.queue = new Queue();
    }

    addSong(song: Song): boolean {
        this.queue.addSong(song);

        const code = this.getRoom();
        if(!code) return false;

        const room = rooms.get(code);
        if(!room) return false;
        room.queue.addSong(song);

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
