import { keepChatDataIn } from "../src/agent/row-cache.ts";
import { configureFetchPolicy } from "../src/lib/safe-fetch.ts";
import { createLocalStore } from "../src/lib/store.ts";

export const TEST_FETCH_POLICY = { resolve: async () => ["93.184.216.34"] };

configureFetchPolicy(TEST_FETCH_POLICY);

keepChatDataIn(createLocalStore());
