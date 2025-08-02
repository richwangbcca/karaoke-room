import { Song } from './structures'
import { rooms } from './roomManager'

export function addSong(code: string, userId: string, song: Song): boolean {
    const room = rooms.get(code);
    if (!room) return false;

    const user = room.users.get(userId);
    if (!user) return false;
    user.queue.push(song);
    return true;
}

export function getRoundRobinQueue(code: string): Song[] {
    const room = rooms.get(code);
    if (!room) return [];

    const queues = Array.from(room.users.values()).map((user) => [...user.queue]);
    const result: Song[] = [];
    let added = true;

    while (added) {
        added = false;
        for (const queue of queues) {
            if (queue.length > 0) {
                result.push(queue.shift()!);
                added = true;
            }
        }
    }

    return result;
}