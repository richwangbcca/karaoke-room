import { v4 as uuidv4 } from 'uuid';

export class Queue {
    queue: Song[];
    length: number;

    constructor() {
        this.queue = [];
        this.length = 0;
    }

    addSong(song: Song): boolean {
        this.queue.push(song);
        this.length += 1;
        return true;
    }

    skipSong(): Song | null {
        if (this.queue.length === 0) return null;
        const song = this.queue[0];

        this.queue.shift();
        this.length -= 1;

        return song;
    }

    removeSong(song: Song): boolean {
        return true;
    }

    removeUser(userId: string): boolean {
        for (let i = this.queue.length - 1; i >= 1; i--) {
            if (this.queue[i].requestedBy === userId) {
                this.queue.splice(i, 1);
                this.length -= 1;
            }
        }

        return true;
    }
}

export class Song {
    id: string;
    title: string;
    artists: string[];
    videoId: string;
    requestedBy: string;
    singer: string;
    albumImage: string;

    constructor(title: string, artists: string[], videoId: string, requestedBy: string, singer: string, albumImage: string) {
        this.id = uuidv4();
        this.title = title;
        this.artists = artists,
        this.videoId = videoId;
        this.requestedBy = requestedBy;
        this.singer = singer;
        this.albumImage = albumImage;
    }
}