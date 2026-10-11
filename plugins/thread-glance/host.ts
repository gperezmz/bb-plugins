// Thread Glance host entry: runs on each machine bb runs threads on and lists
// the listening ports of the processes working inside workspaces. See
// host/scan.ts.
import { createHostEntry } from "./host/handlers";

export default createHostEntry();
