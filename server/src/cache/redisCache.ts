import { createClient } from 'redis';

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

let connecting: Promise<void> | null = null;

async function ready(): Promise<void> {
    if (client.isOpen) return;
    if (!connecting) {
        connecting = client.connect().then(() => { connecting = null; });
    }
    await connecting;
}

export const normalizeKey = (key: string): string => key.toLowerCase().trim();

export class RedisCache<T> {
    constructor(private prefix: string, private ttlSeconds: number) {}

    private getKey(key: string): string {
        return `${this.prefix}:${normalizeKey(key)}`;
    }

    // undefined means cache miss. A hit may still hold a null value (a cached negative result).
    async get(key: string): Promise<T | undefined> {
        try {
            await ready();
            const raw = await client.get(this.getKey(key));
            return raw === null ? undefined : (JSON.parse(raw) as T);
        } catch (error) {
            console.error(`Error reading ${this.prefix} cache:`, error);
            return undefined;
        }
    }

    async set(key: string, value: T, ttlSeconds = this.ttlSeconds): Promise<void> {
        try {
            await ready();
            await client.setEx(this.getKey(key), ttlSeconds, JSON.stringify(value));
        } catch (error) {
            console.error(`Error writing ${this.prefix} cache:`, error);
        }
    }
}

const DAY = 24 * 60 * 60;

// A cached null means "searched, found nothing playable" 
// Short TTL so uploads that appear later get picked up
export const NEGATIVE_TTL = 60 * 60;

export const youtubeCache = new RedisCache<string | null>('youtube', 30 * DAY);

export type SpotifyTrack = {
    trackId: string;
    trackName: string;
    artists: string[];
    albumImage: string | null;
};

export const spotifyCache = new RedisCache<SpotifyTrack[]>('spotify', DAY);
