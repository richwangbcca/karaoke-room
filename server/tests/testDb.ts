import { createClient } from 'redis';

// Tests run against a scratch Redis database so a run never writes into the dev cache. Entries
// there live for 30 days, so polluting it once pollutes it for a month.
export const TEST_REDIS_URL = 'redis://localhost:6379/15';

// Must run before anything imports the cache module, which reads REDIS_URL at load time.
export async function useTestDb(): Promise<void> {
    process.env.REDIS_URL = TEST_REDIS_URL;

    const admin = createClient({ url: TEST_REDIS_URL });
    await admin.connect();
    await admin.flushDb();
    await admin.quit();
}
