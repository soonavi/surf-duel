/**
 * In-memory RoomTransport for tests: a hub that delivers presence and
 * broadcasts synchronously between transports on the same topic.
 */
import type { PresenceEntry, RoomTransport, TransportHandlers } from './transport';

interface Peer {
  key: string;
  meta: object | null;
  handlers: TransportHandlers;
}

export class MemoryHub {
  private readonly topics = new Map<string, Set<Peer>>();
  /** Every broadcast sent, for assertions: [topic, event, payload]. */
  readonly sent: [string, string, unknown][] = [];
  /**
   * Like Supabase: a newcomer sees its own presence first and everyone
   * already in the room only this many ms later (0 = all at once).
   */
  constructor(private readonly existingMembersDelayMs = 0) {}

  transport(): RoomTransport {
    let topic = '';
    let me: Peer | null = null;
    const hub = this;
    return {
      async connect(t, key, handlers) {
        topic = t;
        me = { key, meta: null, handlers };
        if (!hub.topics.has(t)) hub.topics.set(t, new Set());
        hub.topics.get(t)!.add(me);
        handlers.onStatus('connected');
      },
      async track(meta) {
        if (!me) throw new Error('not connected');
        const first = me.meta === null;
        me.meta = structuredClone(meta);
        if (first && hub.existingMembersDelayMs > 0) {
          // The newcomer only sees itself at first; the rest of the room arrives later.
          me.handlers.onPresence([{ key: me.key, meta: structuredClone(me.meta) }]);
          const peer = me;
          setTimeout(() => {
            if (hub.topics.get(topic)?.has(peer)) hub.syncPresence(topic);
          }, hub.existingMembersDelayMs);
          for (const other of hub.topics.get(topic) ?? []) if (other !== me) other.handlers.onPresence(hub.entries(topic));
          return;
        }
        hub.syncPresence(topic);
      },
      send(event, payload) {
        if (!me) return;
        hub.sent.push([topic, event, payload]);
        for (const peer of hub.topics.get(topic) ?? []) {
          if (peer !== me) peer.handlers.onBroadcast(event, structuredClone(payload));
        }
      },
      async disconnect() {
        if (!me) return;
        hub.topics.get(topic)?.delete(me);
        me.handlers.onStatus('closed');
        me = null;
        hub.syncPresence(topic);
      },
    };
  }

  /** Number of tracked members on a topic. */
  members(topic: string): number {
    return [...(this.topics.get(topic) ?? [])].filter((p) => p.meta).length;
  }

  private entries(topic: string): PresenceEntry[] {
    return [...(this.topics.get(topic) ?? [])].filter((p) => p.meta).map((p) => ({ key: p.key, meta: structuredClone(p.meta) }));
  }

  private syncPresence(topic: string): void {
    const peers = this.topics.get(topic);
    if (!peers) return;
    for (const peer of peers) peer.handlers.onPresence(this.entries(topic));
  }
}
