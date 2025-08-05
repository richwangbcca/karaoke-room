import { Song } from './structures'
import { rooms } from './roomManager'

export function addSong(code: string, userId: string, song: Song): boolean {
    const room = rooms.get(code);
    if (!room) return false;

    const user = room.users.get(userId);
    if (!user) return false;
    user.queue.push(song);
    room.queue.push(song);
    return true;
}

export function skipSong(code: string): boolean {
    const room = rooms.get(code);
    if (!room) return false;

    const curQueue = room.queue;
    if (!curQueue || curQueue.length === 0) return false; 

    const user = room.users.get(curQueue[0].requestedBy);
    if (!user) return false;

    room.queue.shift();
    user.queue.shift();

    return true;
}