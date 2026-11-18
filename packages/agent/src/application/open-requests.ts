import { randomBytes } from 'node:crypto';

export interface OpenRequest {
  id: string;
  url: string;
}

// The page each workspace last asked the phone to open, kept until a device answers it: the phone
// is often asleep when a tool asks, and shows it on its next attach. One per workspace, the latest
// winning, so a program asking in a loop holds one entry. In memory only: the URL can carry a
// login code, so it is never written to disk or logged.
export class OpenRequests {
  private readonly pending = new Map<string, OpenRequest>();
  // Null when that URL is already the one waiting.
  set(workspaceId: string, url: string): OpenRequest | null {
    if (this.pending.get(workspaceId)?.url === url) return null;
    // Random, not counted: a phone's answer to a request from before an agent restart must not
    // clear a new one that happens to reuse its number.
    const request = { id: randomBytes(6).toString('hex'), url };
    this.pending.set(workspaceId, request);
    return request;
  }

  get(workspaceId: string): OpenRequest | undefined {
    return this.pending.get(workspaceId);
  }

  done(workspaceId: string, id: string): boolean {
    if (this.pending.get(workspaceId)?.id !== id) return false;
    this.pending.delete(workspaceId);
    return true;
  }

  forget(workspaceId: string): void {
    this.pending.delete(workspaceId);
  }
}
