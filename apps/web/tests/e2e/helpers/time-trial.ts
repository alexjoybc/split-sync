/**
 * TEST SETUP ONLY — never import this file from app code.
 *
 * Helpers for seeding time-trial races in e2e tests against the local
 * Supabase stack.
 */
import { createTestSupabaseClient } from './supabase';

/**
 * Sign in as organizer, create a live TT event with 3 entries (bibs 10, 9, 2
 * in insertion order — intentionally unsorted to verify natural bib ordering
 * in the UI).
 */
export async function seedTimeTrialRace(
  organizerEmail: string,
  organizerPassword: string
) {
  const client = createTestSupabaseClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: organizerEmail,
    password: organizerPassword,
  });
  if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

  // Get the authenticated user so we can set owner_id (required by RLS)
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('No authenticated user after sign-in');

  // Create event (status: live so spectator RLS allows reads)
  const { data: event, error: eventError } = await client
    .from('events')
    .insert({
      title: `TT Test Event ${Date.now()}`,
      sport_type: 'General',
      status: 'live',
      location: 'Test Venue',
      owner_id: user.id,
    })
    .select()
    .single();
  if (eventError || !event) throw new Error(`Failed to create event: ${eventError?.message}`);

  // Create TT race as 'upcoming' so entries can be inserted (RLS blocks inserts on active races)
  const { data: race, error: raceError } = await client
    .from('races')
    .insert({
      event_id: event.id,
      name: 'Time Trial',
      sequence_order: 1,
      laps_planned: null,
      is_time_trial: true,
      time_trial_countdown_seconds: 3,
      status: 'upcoming',
    })
    .select()
    .single();
  if (raceError || !race) throw new Error(`Failed to create race: ${raceError?.message}`);

  // Create participants (bibs in non-sorted order to exercise natural sort)
  const bibDefs = [
    { bib: '10', first_name: 'Alice' },
    { bib: '9',  first_name: 'Bob'   },
    { bib: '2',  first_name: 'Carol' },
  ];
  const { error: pErr } = await client.from('participants').insert(
    bibDefs.map((d) => ({
      event_id: event.id,
      bib: d.bib,
      first_name: d.first_name,
      last_name: null,
      team: null,
      category: null,
    }))
  );
  if (pErr) throw new Error(`Failed to insert participants: ${pErr.message}`);

  // Fetch participants to get their IDs
  const { data: participants, error: fetchErr } = await client
    .from('participants')
    .select()
    .eq('event_id', event.id);
  if (fetchErr) throw new Error(`Failed to fetch participants: ${fetchErr.message}`);

  // Create entries
  const { error: eErr } = await client.from('entries').insert(
    (participants ?? []).map((p) => ({
      race_id: race.id,
      bib: p.bib,
      name: p.first_name,
      team: null,
      category: null,
    }))
  );
  if (eErr) throw new Error(`Failed to insert entries: ${eErr.message}`);

  // Now start the race so crossings can be inserted
  const { error: startErr } = await client
    .from('races')
    .update({ status: 'active' })
    .eq('id', race.id);
  if (startErr) throw new Error(`Failed to start race: ${startErr.message}`);

  return { event, race: { ...race, status: 'active' as const }, client };
}

/**
 * Insert a single crossing for the given bib, offset from now by offsetMs.
 * Uses the signed-in client returned by seedTimeTrialRace.
 */
export async function insertCrossing(
  client: ReturnType<typeof createTestSupabaseClient>,
  raceId: string,
  bib: string,
  offsetMs = 0
) {
  const now = new Date(Date.now() + offsetMs).toISOString();
  const { data, error } = await client
    .from('crossings')
    .insert({
      race_id: raceId,
      bib,
      client_id: crypto.randomUUID(),
      client_recorded_at: now,
      recorded_at: now,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to insert crossing: ${error.message}`);
  return data;
}
