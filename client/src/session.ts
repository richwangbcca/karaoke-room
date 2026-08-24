// Persisted so a reload or a phone that slept can reclaim its place instead of starting over. The
// tokens here are bearer secrets the server issued to this client; keep them out of anything that is
// shared or rendered.

export type HostSession = { code: string; hostToken: string };
export type GuestSession = { code: string; userId: string; token: string; name: string };

const HOST = 'karaoke:host';
const GUEST = 'karaoke:guest';

const read = <T>(key: string): T | null => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
};

export const loadHost = (): HostSession | null => read<HostSession>(HOST);
export const saveHost = (s: HostSession): void => localStorage.setItem(HOST, JSON.stringify(s));
export const clearHost = (): void => localStorage.removeItem(HOST);

export const loadGuest = (): GuestSession | null => read<GuestSession>(GUEST);
export const saveGuest = (s: GuestSession): void => localStorage.setItem(GUEST, JSON.stringify(s));
export const clearGuest = (): void => localStorage.removeItem(GUEST);
