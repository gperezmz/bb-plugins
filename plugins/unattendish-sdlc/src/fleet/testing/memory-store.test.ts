import { InMemoryStore } from "./memory-store";
import { describeStore } from "./store-contract";

describeStore("InMemoryStore", () => ({ store: new InMemoryStore() }));
