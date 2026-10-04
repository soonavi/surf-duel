/**
 * Supabase Realtime implementation of RoomTransport: one channel per room,
 * presence for the player list, broadcast for everything else.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { PresenceEntry, RoomTransport, TransportHandlers } from './transport';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // Client-side safety valve; the Room's own batching keeps us far below this.
      realtime: { params: { eventsPerSecond: 40 } },
    });
  }
  return client;
}

const CONNECT_TIMEOUT_MS = 10_000;

export function supabaseTransport(): RoomTransport {
  let channel: RealtimeChannel | null = null;
  let lastMeta: object | null = null;
  let everConnected = false;

  return {
    connect(topic: string, key: string, handlers: TransportHandlers): Promise<void> {
      const ch = getClient().channel(topic, {
        config: { presence: { key }, broadcast: { self: false, ack: false } },
      });
      channel = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const entries: PresenceEntry[] = [];
        for (const [k, metas] of Object.entries(state)) {
          const latest = metas[metas.length - 1];
          if (latest) entries.push({ key: k, meta: latest });
        }
        handlers.onPresence(entries);
      });
      ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => handlers.onBroadcast(msg.event, msg.payload));

      return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Timed out connecting to the room server')), CONNECT_TIMEOUT_MS);
        ch.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            window.clearTimeout(timer);
            handlers.onStatus('connected');
            // After a reconnect, presence must be published again.
            if (everConnected && lastMeta) void ch.track(lastMeta);
            everConnected = true;
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            handlers.onStatus('reconnecting');
            if (!everConnected) {
              window.clearTimeout(timer);
              reject(err ?? new Error(`Room connection failed (${status})`));
            }
          } else if (status === 'CLOSED') {
            handlers.onStatus('closed');
          }
        });
      });
    },

    async track(meta: object): Promise<void> {
      lastMeta = meta;
      if (channel) await channel.track(meta as Record<string, unknown>);
    },

    send(event: string, payload: object): void {
      if (channel) void channel.send({ type: 'broadcast', event, payload });
    },

    async disconnect(): Promise<void> {
      const ch = channel;
      channel = null;
      lastMeta = null;
      if (ch) {
        await ch.untrack().catch(() => undefined);
        await getClient().removeChannel(ch);
      }
    },
  };
}
