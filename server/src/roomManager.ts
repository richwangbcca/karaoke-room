/*
TODO: Refactor into class based RoomManager
*/
import { User, Room } from './structures'

export const rooms = new Map<string, Room>();

export function createRoom(hostSocketId: string): string {
    const code = generateRoomCode();
    rooms.set(code, {
        code,
        hostId: hostSocketId,
        users: new Map(),
    });
    return code;
}

export function joinRoom(code: string, user: User): boolean {
    const room = rooms.get(code);
    if (!room) return false;
    room.users.set(user.id, user)
    return true
}

export function getRoom(code: string): Room | undefined {
    return rooms.get(code);
}

function generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
    return Array.from ({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
