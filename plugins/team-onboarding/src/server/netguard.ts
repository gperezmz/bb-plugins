// The server's second look before it connects: a public-looking name can
// still resolve to this machine or its network (127.0.0.1.nip.io, a record
// someone controls). Checked right before each fetch, clone or ls-remote.
import { lookup } from "node:dns/promises";
import { hostOf, isAllowedSourceUrl, isInternalHost } from "../core/netguard.js";

export class InternalHostError extends Error {
  constructor() {
    super("That host resolves to this machine or a private network address.");
  }
}

/** Throws unless the URL is a local path or every address its host resolves to is public. */
export async function assertPublicUrl(url: string, resolve: typeof lookup = lookup): Promise<void> {
  if (!isAllowedSourceUrl(url)) throw new InternalHostError();
  if (/^(file:\/\/|\/)/i.test(url)) return;
  const host = hostOf(url);
  if (host === null || isInternalHost(host)) throw new InternalHostError();
  if (/^[\d.]+$/.test(host) || host.includes(":")) return;
  let addresses: { address: string }[];
  try {
    addresses = await resolve(host, { all: true, verbatim: true });
  } catch {
    // Unresolvable: git and fetch fail on their own, with the network category.
    return;
  }
  if (addresses.some((entry) => isInternalHost(entry.address))) throw new InternalHostError();
}
