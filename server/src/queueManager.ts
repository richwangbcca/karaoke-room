import { v4 as uuidv4 } from 'uuid';

export class Queue {
    queue: Song[];

    constructor() {
        this.queue = [];
    }

    addSong(song: Song): boolean {
        this.queue.push(song);
        return true;
    }

    skipSong(): Song | null {
        if (this.queue.length === 0) return null;
        const song = this.queue[0];

        this.queue.shift();

        return song;
    }

    removeSong(toRemoveId: string): Song | null {
        const index = this.queue.findIndex(song => song.id === toRemoveId)
        if (index == -1) return null;

        const song = this.queue[index];
        this.queue.splice(index, 1);
        return song;
    }

    removeUser(userId: string): boolean {
        for (let i = this.queue.length - 1; i >= 1; i--) {
            if (this.queue[i].requestedBy === userId) {
                this.queue.splice(i, 1);
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