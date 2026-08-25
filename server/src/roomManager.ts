import { randomInt, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Queue, Song } from './queueManager'

export const rooms = new Map<string, Room>();

// A bearer secret for reconnecting. Distinct from the public id/code, which are broadcast: a resume
// credential must never be something another client can see.
const secret = (): string => randomBytes(24).toString('base64url');

export class Room {
    code: string;
    hostId: string;
    // Secret the host presents to reclaim the room after a reconnect. Never broadcast.
    hostToken: string;
    users: Map<string, User>;
    queue: Queue;
    // Failure strikes per search term for this room's player. Scoped to the room, not shared: the
    // host is the only one who can report a failure and they can already skip anything here, so a
    // bad verdict costs them their own room and nobody else's. Dies with the room.
    //
    // Counted rather than a flat blocklist because a failure is not always the song's fault - a
    // stalled network times the trial out just like an unplayable video would, and one stall must
    // not cost the party a good song for the rest of the night.
    strikes: Map<string, number>;

    constructor(hostSocketId: string) {
        this.code = generateRoomCode();
        this.hostId = hostSocketId;
        this.hostToken = secret();
        this.users = new Map();
        this.queue = new Queue();
        this.strikes = new Map();
    }

    // A definitive player error blocks at once; an ambiguous timeout needs a second opinion.
    strike(searchTerm: string, weight: number): void {
        this.strikes.set(searchTerm, (this.strikes.get(searchTerm) ?? 0) + weight);
    }

    isBlocked(searchTerm: string, threshold: number): boolean {
        return (this.strikes.get(searchTerm) ?? 0) >= threshold;
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

    closeRoom(): boolean {
        this.users.forEach((user, _) => {
            socketRoomMap.delete(user.socketId);
            socketUserIdMap.delete(user.socketId);
        });
        return true;
    }
}

export const socketRoomMap = new Map<string, string>();    // User socket id : room code
export const socketUserIdMap = new Map<string, string>();  // User socked id : user id

export class User {
    id: string;
    name: string;
    socketId: string;
    // Secret the guest presents to reclaim this identity after a reconnect. Unlike id, which is
    // broadcast in the queue and member list, this never leaves the server except to its owner - so
    // a guest cannot hijack another by replaying a userId they saw.
    token: string;

    constructor(name: string, userSocketId: string) {
        this.id = uuidv4();
        this.name = name;
        this.socketId = userSocketId;
        this.token = secret();
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


// randomInt, not Math.random: V8's generator leaks its state through its output, so anyone who
// creates a few rooms could predict the codes handed to everyone else.
function generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    const draw = () => Array.from({ length: 5 }, () => chars[randomInt(chars.length)]).join('');

    let code = draw();
    while(rooms.has(code)) {
        code = draw();
    }
    return code;
}
