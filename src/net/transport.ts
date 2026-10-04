/**
 * The network seam. A Room talks to a RoomTransport; the game uses the
 * Supabase Realtime implementation (supabase.ts), tests use an in-memory hub.
 */

export interface PresenceEntry {
  key: string;
  /** Unvalidated payload; the Room parses it. */
  meta: unknown;
}

export type TransportStatus = 'connected' | 'reconnecting' | 'closed';

export interface TransportHandlers {
  /** Full presence state, after any join/leave/update. */
  onPresence(entries: PresenceEntry[]): void;
  onBroadcast(event: string, payload: unknown): void;
  onStatus(status: TransportStatus): void;
}

export interface RoomTransport {
  /** Subscribe to `topic` with presence key `key`. Resolves once connected. */
  connect(topic: string, key: string, handlers: TransportHandlers): Promise<void>;
  /** Publish (or replace) our presence payload. */
  track(meta: object): Promise<void>;
  /** Fire-and-forget broadcast to everyone else in the room. */
  send(event: string, payload: object): void;
  disconnect(): Promise<void>;
}
