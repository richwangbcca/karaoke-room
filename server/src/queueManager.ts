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

export interface Song {
    id: string;
    title: string;
    artists: string[];
    // null until the host has actually played one - only the host's real player can tell whether a
    // video is playable, since embed and age restrictions do not surface until playback starts.
    videoId: string | null;
    candidates: string[];
    searchTerm: string; // cache key, so the host's verdict lands on the right entry
    requestedBy: string;
    singer: string;
    albumImage: string | null;
}