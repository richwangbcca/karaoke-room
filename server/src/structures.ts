export type Song = {
    id: string;
    title: string;
    videoId: string;
    requestedBy: string;
}

export type User = {
    id: string;
    name: string;
    socketId: string;
    queue: Song[];
}

export type Room = {
    code: string;
    hostId: string;
    users: Map<string, User>;
}