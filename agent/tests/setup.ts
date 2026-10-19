import { configureFetchPolicy } from "../src/lib/safe-fetch";

/**
 * Tests that mock `fetch` use made-up host names. The guard that every fetch of a client's URL goes
 * through (src/lib/safe-fetch.ts) looks a name up before it fetches, so here every name resolves to a
 * public address and no test reaches DNS. A test of the guard itself sets its own policy.
 */
export const TEST_FETCH_POLICY = { resolve: async () => ["93.184.216.34"] };

configureFetchPolicy(TEST_FETCH_POLICY);
