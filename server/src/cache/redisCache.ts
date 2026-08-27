import { createClient } from 'redis';

// The cache is an optimisation, never a dependency: if Redis is unreachable the app has to keep
// working, just without the savings. That only holds if every path here fails FAST. node-redis
// retries a dead connection indefinitely and queues commands while it does, so an unset REDIS_URL
// would otherwise hang every request that touches the cache rather than skipping it.
const CONNECT_TIMEOUT_MS = 2_000;
const RETRY_COOLDOWN_MS = 30_000;

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Stop reconnecting instead of looping forever; ready() tries again after the cooldown.
        reconnectStrategy: (retries) => (retries > 2 ? false : 200 * (retries + 1)),
    },
    // Fail a command outright when disconnected rather than parking it until a reconnect.
    disableOfflineQueue: true,
});

// A cache outage is one condition, not one-per-request: while Redis is down every lookup and every
// reconnect attempt reports it, which would bury the logs. Report it at most once per cooldown.
let lastErrorLogged = 0;
const noteOutage = (context: string, err: unknown): void => {
    const now = Date.now();
    if (now - lastErrorLogged < RETRY_COOLDOWN_MS) return;
    lastErrorLogged = now;
    console.error(`Redis unavailable (${context}), serving uncached:`, (err as Error)?.message ?? err);
};

// An unhandled 'error' event would take the process down, so this has to exist even though every
// caller below already handles its own failure.
client.on('error', (err: unknown) => noteOutage('connection', err));

let connecting: Promise<void> | null = null;
let downUntil = 0;

async function ready(): Promise<void> {
    if (client.isOpen) return;

    // While Redis is known to be down, go straight to the miss path. Paying the connect timeout on
    // every request would make having a cache slower than not having one.
    if (Date.now() < downUntil) throw new Error('Redis unavailable');

    if (!connecting) {
        // Cleared on failure as well as success - leaving a rejected promise here would poison the
        // cache permanently, so it could never recover once Redis came back.
        connecting = client.connect().then(
            () => { connecting = null; },
            (err) => {
                connecting = null;
                downUntil = Date.now() + RETRY_COOLDOWN_MS;
                throw err;
            },
        );
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
            noteOutage(`${this.prefix} read`, error);
            return undefined;
        }
    }

    async set(key: string, value: T, ttlSeconds = this.ttlSeconds): Promise<void> {
        try {
            await ready();
            await client.setEx(this.getKey(key), ttlSeconds, JSON.stringify(value));
        } catch (error) {
            noteOutage(`${this.prefix} write`, error);
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
