import { createClient } from '@supabase/supabase-js';

// TEST SETUP ONLY — never import this in production app code.
// These helpers assume a local Supabase instance (supabase db reset).

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7b6b7xNHPnjyxvFnDpvnuN51o4MXVToypGc';

/** Anon client (no user auth) — suitable for reading published events only. */
const db = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Authenticated client scoped to a specific user's access token.
 * The token must come from `signInProgrammatically().session.access_token`.
 * RLS policies that check `auth.jwt()->>'sub'` (e.g. events write, races) are
 * satisfied only by an authenticated client — the anon client has no `sub`.
 *
 * Exported so specs can perform direct RLS assertions without duplicating the
 * client-construction logic inline.
 */
export const authedDb = (accessToken: string) =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

/**
 * Stable seed UUIDs — match supabase/seed.sql exactly.
 * Use these constants in specs that read seed data rather than hard-coding strings.
 */
export const SEED = {
  PUBLISHED_EVENT_ID: 'a0000000-0000-0000-0000-000000000001',
  DRAFT_EVENT_ID:     'a0000000-0000-0000-0000-000000000002',
  RACE_A_ID:          'b0000000-0000-0000-0000-000000000001',
  RACE_B_ID:          'b0000000-0000-0000-0000-000000000002',
} as const;

/**
 * Build a fresh, isolated event + roster + race + entries for specs that need
 * bespoke state. Returns IDs for use in assertions.
 *
 * Pass `accessToken` (from `signInProgrammatically().session.access_token`) so
 * the event's `owner_id` is set to the authenticated user. This is required for
 * scoring-console specs where RLS checks ownership before allowing writes.
 *
 * Without `accessToken` (anon insert) the event will have `owner_id = null` and
 * the scoring console will deny access — only use the unauthenticated form for
 * tests that do not exercise organizer-gated UI.
 *
 * @example
 * const { session } = await signInProgrammatically(email, password);
 * const { eventId, raceId } = await buildEvent({ status: 'live', bibs: ['1','2'], accessToken: session!.access_token });
 */
export async function buildEvent(opts: {
  title?: string;
  status?: 'draft' | 'live' | 'finished';
  bibs?: string[];
  /** JWT access token for the organizer who will own this event. */
  accessToken?: string;
} = {}): Promise<{ eventId: string; raceId: string }> {
  const title  = opts.title  ?? `Test Event ${Date.now()}`;
  const status = opts.status ?? 'draft';
  const bibs   = opts.bibs   ?? ['1', '2', '3'];
  const client = opts.accessToken ? authedDb(opts.accessToken) : db();

  // Event
  const { data: event, error: eventErr } = await client
    .from('events')
    .insert({ title, sport_type: 'velodrome', status })
    .select('id')
    .single();
  if (eventErr) throw eventErr;
  const eventId = event.id as string;

  // Participants — roster first (domain invariant #3)
  const participants = bibs.map((bib, i) => ({
    event_id: eventId,
    bib,
    name: `Rider ${bib}`,
    team: i % 2 === 0 ? 'Team A' : 'Team B',
  }));
  const { error: pErr } = await client.from('participants').insert(participants);
  if (pErr) throw pErr;

  // Race
  const { data: race, error: raceErr } = await client
    .from('races')
    .insert({ event_id: eventId, name: 'Test Race', sequence_order: 1, laps_planned: 5 })
    .select('id')
    .single();
  if (raceErr) throw raceErr;
  const raceId = race.id as string;

  // Entries from roster
  const entries = bibs.map((bib) => ({ race_id: raceId, bib, name: `Rider ${bib}` }));
  const { error: eErr } = await client.from('entries').insert(entries);
  if (eErr) throw eErr;

  return { eventId, raceId };
}

/**
 * Record crossings for a race to simulate active scoring.
 * Each bib gets one crossing, offset by 1 s so standings are deterministic.
 *
 * Pass `accessToken` when the race belongs to an authenticated user (RLS-protected).
 *
 * @example
 * await recordCrossings(raceId, ['1', '2', '3'], accessToken);
 */
export async function recordCrossings(
  raceId: string,
  bibs: string[],
  accessToken?: string,
): Promise<void> {
  const client = accessToken ? authedDb(accessToken) : db();
  const base = Date.now();
  const crossings = bibs.map((bib, i) => ({
    race_id: raceId,
    bib,
    client_id: crypto.randomUUID(),
    client_recorded_at: new Date(base + i * 1000).toISOString(),
  }));
  const { error } = await client.from('crossings').insert(crossings);
  if (error) throw error;
}
