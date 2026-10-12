import { describeAccountStore } from "./account-store-contract";
import { InMemoryAccounts } from "./memory-accounts";
import { InMemoryStore } from "./memory-store";
import { describeStore } from "./store-contract";

describeStore("InMemoryStore", () => ({ store: new InMemoryStore() }));

describeAccountStore("InMemoryAccounts", () => ({ store: new InMemoryAccounts() }));
