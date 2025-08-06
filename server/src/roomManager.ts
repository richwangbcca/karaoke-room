import { User, Room } from './structures'

export const rooms = new Map<string, Room>();

export function createRoom(hostSocketId: string): string {
    const code = generateRoomCode();
    rooms.set(code, {
        code,
        hostId: hostSocketId,
        users: new Map(),
        userNames: [],
        queue: [],
    });
    return code;
}

export function joinRoom(code: string, user: User): boolean {
    const room = rooms.get(code);
    if (!room) return false;
    room.users.set(user.id, user);
    room.userNames.push(user.name);

    return true;
}

export function leaveRoom(code: string, userId: string) {
    const room = rooms.get(code);
    if (!room) return false;

    const users = room.users;
    const user = users.get(userId);
    if (!user) return false;

    const index = room.userNames.indexOf(user.name);
    if (index !== -1) {
        room.userNames.splice(index, 1);
    }

    const queue = room.queue;
    for (let i = queue.length - 1; i >= 1; i--) {
        if (queue[i].requestedBy === userId) {
        room.queue.splice(i, 1);
    }

    users.delete(userId);

    return true;
  }
}

export function getRoom(code: string): Room | undefined {
    return rooms.get(code);
}

function generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    return Array.from ({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
