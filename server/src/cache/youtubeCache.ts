import { createClient } from 'redis';

interface CachedVideo {
    videoId: string;
    searchTerm: string;
    cachedAt: number;
    lastAccessed: number;
}

export class YouTubeCache {
    private client;
    private readonly maxItems = 1000;
    private readonly ttlSeconds = 30 * 24 * 60 * 60; // 1 month

    constructor() {
        this.client = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });
    }

    async connect(): Promise<void> {
        if (!this.client.isOpen) {
            await this.client.connect();
        }
    }

    async disconnect(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.disconnect();
        }
    }

    private getKey(searchTerm: string): string {
        return `youtube:${searchTerm.toLowerCase().trim()}`;
    }

    async get(searchTerm: string): Promise<string | null> {
        try {
            await this.connect();
            const key = this.getKey(searchTerm);
            const cached = await this.client.get(key);

            if (cached) {
                const data: CachedVideo = JSON.parse(cached);

                data.lastAccessed = Date.now();
                await this.client.setEx(key, this.ttlSeconds, JSON.stringify(data));

                return data.videoId;
            }

            return null;
        } catch (error) {
            console.error('Error getting from YouTube cache:', error);
            return null;
        }
    }

    async set(searchTerm: string, videoId: string): Promise<void> {
        try {
            await this.connect();
            const key = this.getKey(searchTerm);

            await this.enforceMaxItems();

            const data: CachedVideo = {
                videoId,
                searchTerm: searchTerm.trim(),
                cachedAt: Date.now(),
                lastAccessed: Date.now()
            };

            await this.client.setEx(key, this.ttlSeconds, JSON.stringify(data));
        } catch (error) {
            console.error('Error setting YouTube cache:', error);
        }
    }

    private async enforceMaxItems(): Promise<void> {
        try {
            const keys = await this.client.keys('youtube:*');

            if (keys.length >= this.maxItems) {
                const pipeline = this.client.multi();
                keys.forEach(key => pipeline.get(key));
                const results = await pipeline.exec();

                // Sort by LRU and remove least recently used entries
                const itemsWithAccess = keys.map((key, index) => {
                    const result = results?.[index];
                    const data = result && typeof result === 'string' ? result : null;
                    if (data) {
                        try {
                            const parsed: CachedVideo = JSON.parse(data);
                            return { key, lastAccessed: parsed.lastAccessed || parsed.cachedAt };
                        } catch (error) {
                            console.error('Error parsing cached data:', error);
                        }
                    }
                    return { key, lastAccessed: 0 };
                }).sort((a, b) => a.lastAccessed - b.lastAccessed);

                // Remove least recently used 5% to make room
                const toRemove = Math.max(1, Math.floor(this.maxItems * 0.05));
                const keysToDelete = itemsWithAccess.slice(0, toRemove).map(item => item.key);

                if (keysToDelete.length > 0) {
                    await this.client.del(keysToDelete);
                }
            }
        } catch (error) {
            console.error('Error enforcing max items in YouTube cache:', error);
        }
    }

    async clear(): Promise<void> {
        try {
            await this.connect();
            const keys = await this.client.keys('youtube:*');
            if (keys.length > 0) {
                await this.client.del(keys);
            }
        } catch (error) {
            console.error('Error clearing YouTube cache:', error);
        }
    }

    async getStats(): Promise<{ count: number; keys: string[] }> {
        try {
            await this.connect();
            const keys = await this.client.keys('youtube:*');
            return { count: keys.length, keys };
        } catch (error) {
            console.error('Error getting YouTube cache stats:', error);
            return { count: 0, keys: [] };
        }
    }
}

export const youtubeCache = new YouTubeCache();