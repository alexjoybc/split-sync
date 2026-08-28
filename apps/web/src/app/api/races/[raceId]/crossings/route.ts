import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiRequest } from "@/lib/server/supabaseApi";
import type { RaceStatus } from "@/lib/types";

// UUID v4 regex for basic format validation of client_id
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CrossingInput {
  bib: string;
  client_id: string;
  client_recorded_at: string;
}

type CrossingResult =
  | { client_id: string; bib: string; status: "inserted"; id: string }
  | { client_id: string; bib: string; status: "already_applied" }
  | { client_id: string; bib: string; status: "rejected"; reason: string };

// The Supabase client returned by authenticateApiRequest is untyped
// (createClient called without a Database generic). We use explicit interfaces
// for the rows we care about and cast via `unknown` so TypeScript doesn't
// complain about the mismatch between PostgrestBuilder and Promise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = SupabaseClient<any, any, any>;

interface RaceRow {
  id: string;
  status: RaceStatus;
  event_id: string;
}

interface EntryBibRow {
  bib: string;
}

interface CrossingInsertResult {
  data: { id: string } | null;
  error: { code: string; message: string } | null;
}

interface RaceQueryResult {
  data: RaceRow | null;
  error: { message: string } | null;
}

interface EntryQueryResult {
  data: EntryBibRow[] | null;
  error: { message: string } | null;
}

// Wraps the untyped Supabase query builder in explicit typed async functions.
// The `unknown` double-cast is intentional: PostgrestBuilder is PromiseLike
// but not a full Promise (no .catch/.finally/.toStringTag), so a single `as`
// would be rejected by TypeScript's structural check.

async function fetchRace(
  supabase: UntypedClient,
  raceId: string
): Promise<RaceQueryResult> {
  const result = await supabase
    .from("races")
    .select("id, status, event_id")
    .eq("id", raceId)
    .single();
  return result as unknown as RaceQueryResult;
}

async function fetchEntryBibs(
  supabase: UntypedClient,
  raceId: string,
  bibs: string[]
): Promise<EntryQueryResult> {
  const result = await supabase
    .from("entries")
    .select("bib")
    .eq("race_id", raceId)
    .in("bib", bibs);
  return result as unknown as EntryQueryResult;
}

async function insertCrossing(
  supabase: UntypedClient,
  crossing: {
    race_id: string;
    bib: string;
    client_id: string;
    client_recorded_at: string;
    source: string;
  }
): Promise<CrossingInsertResult> {
  const result = await supabase
    .from("crossings")
    .insert(crossing)
    .select("id")
    .single();
  return result as unknown as CrossingInsertResult;
}

/**
 * POST /api/races/:raceId/crossings
 *
 * Batch crossing-ingestion endpoint for manually-entered finish order.
 * Accepts an ordered array of crossings and writes them to the crossings
 * table with source='manual'. Authorization is delegated entirely to the
 * caller's forwarded JWT and existing RLS policies.
 *
 * See apps/web/src/app/api/README.md for full payload/response documentation.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ raceId: string }> }
) {
  // --- Authentication ---
  const auth = await authenticateApiRequest(request);
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  // --- Route params ---
  const { raceId } = await params;
  if (!UUID_RE.test(raceId)) {
    return Response.json({ error: "Invalid raceId." }, { status: 400 });
  }

  // --- Parse request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("crossings" in body) ||
    !Array.isArray((body as Record<string, unknown>).crossings)
  ) {
    return Response.json(
      { error: "Request body must be { crossings: [...] }." },
      { status: 400 }
    );
  }

  const rawCrossings = (body as { crossings: unknown[] }).crossings;

  if (rawCrossings.length === 0) {
    return Response.json(
      { error: "crossings must be a non-empty array." },
      { status: 400 }
    );
  }

  // --- Per-row input validation (400 for malformed input) ---
  const validationErrors: string[] = [];
  for (let i = 0; i < rawCrossings.length; i++) {
    const c = rawCrossings[i];
    if (!c || typeof c !== "object") {
      validationErrors.push(`crossings[${i}]: must be an object`);
      continue;
    }
    const entry = c as Record<string, unknown>;

    if (
      !entry.bib ||
      typeof entry.bib !== "string" ||
      entry.bib.trim() === ""
    ) {
      validationErrors.push(`crossings[${i}].bib: required non-empty string`);
    }

    if (
      !entry.client_id ||
      typeof entry.client_id !== "string" ||
      !UUID_RE.test(entry.client_id)
    ) {
      validationErrors.push(`crossings[${i}].client_id: must be a UUID`);
    }

    if (
      !entry.client_recorded_at ||
      typeof entry.client_recorded_at !== "string" ||
      isNaN(Date.parse(entry.client_recorded_at))
    ) {
      validationErrors.push(
        `crossings[${i}].client_recorded_at: must be a valid ISO 8601 timestamp`
      );
    }
  }

  if (validationErrors.length > 0) {
    return Response.json(
      { error: "Invalid input.", details: validationErrors },
      { status: 400 }
    );
  }

  const crossings = rawCrossings as CrossingInput[];

  // --- Fetch race (verifies existence; public read so any authenticated caller
  //     can reach this point — authorization is enforced by RLS on insert) ---
  const { data: race, error: raceError } = await fetchRace(supabase, raceId);

  if (raceError || !race) {
    return Response.json({ error: "Race not found." }, { status: 404 });
  }

  // Give a clear pre-flight rejection when the race is not active, rather than
  // bubbling a cryptic RLS error for every row.
  if (race.status !== "active") {
    return Response.json(
      {
        error: `Race is not active (current status: ${race.status}). Crossings may only be recorded while the race is running.`,
      },
      { status: 422 }
    );
  }

  // --- Validate bibs against race entries ---
  // Collect the unique set of bibs so we do one round-trip to the DB.
  const uniqueBibs = [...new Set(crossings.map((c) => c.bib.trim()))];
  const { data: entryRows } = await fetchEntryBibs(
    supabase,
    raceId,
    uniqueBibs
  );

  const validBibs = new Set((entryRows ?? []).map((e) => e.bib));

  // --- Insert crossings row by row, accumulating per-row results ---
  const results: CrossingResult[] = [];

  for (const crossing of crossings) {
    const bib = crossing.bib.trim();

    // Per-row rejection: bib not in race entries.
    if (!validBibs.has(bib)) {
      results.push({
        client_id: crossing.client_id,
        bib,
        status: "rejected",
        reason: "bib not found in race entries",
      });
      continue;
    }

    const { data, error } = await insertCrossing(supabase, {
      race_id: raceId,
      bib,
      client_id: crossing.client_id,
      client_recorded_at: crossing.client_recorded_at,
      source: "manual",
    });

    if (!error && data) {
      // Success
      results.push({
        client_id: crossing.client_id,
        bib,
        status: "inserted",
        id: data.id,
      });
    } else if (error) {
      if (error.code === "23505") {
        // Unique constraint on client_id — idempotent retry, not an error.
        results.push({
          client_id: crossing.client_id,
          bib,
          status: "already_applied",
        });
      } else if (error.code === "42501") {
        // RLS rejected the insert — caller lacks organizer/scorer access or
        // the race is no longer active. Return 403 immediately; no partial
        // inserts are outstanding for rows we have not yet processed.
        return Response.json(
          {
            error:
              "Not authorised to record crossings for this race. Ensure you have organizer or scorer access and the race is still active.",
            results,
          },
          { status: 403 }
        );
      } else {
        // Unexpected database error — treat as a per-row rejection with the
        // raw message so the caller can investigate.
        results.push({
          client_id: crossing.client_id,
          bib,
          status: "rejected",
          reason: error.message,
        });
      }
    }
  }

  return Response.json({ results });
}
