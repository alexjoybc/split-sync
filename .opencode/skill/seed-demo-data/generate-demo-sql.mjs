#!/usr/bin/env node
// Generates a single, self-contained SQL script that seeds realistic demo
// data (events, races, roster, entries, lap-by-lap crossings, penalties) for
// one organizer, identified by their Supabase auth email.
//
// This script only prints SQL to stdout. It never connects to a database and
// never touches any secret (no service_role key, no DB password, no token).
// The owner is resolved *inside* the generated SQL via `auth.users.email`,
// so the caller only needs an email address, not a user id.
//
// Usage:
//   node generate-demo-sql.mjs --owner-email=you@example.com > /tmp/seed.sql
//
// The caller is expected to run the resulting file with:
//   supabase db query --local -f /tmp/seed.sql                 (local dev)
//   supabase db query --project-ref <ref> -f /tmp/seed.sql     (hosted, needs
//                                                                SUPABASE_ACCESS_TOKEN)
//
// Demo events are tagged with the "SplitSync Demo:" title prefix and are
// deleted (cascading to their races/roster/entries/crossings/penalties)
// before being recreated, so re-running this for the same owner is safe and
// idempotent instead of accumulating duplicates.

import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = { events: 3 };
  for (const raw of argv) {
    const [key, ...rest] = raw.replace(/^--/, "").split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const ownerEmail = args["owner-email"] || args.email;

if (!ownerEmail || typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
  console.error("Usage: node generate-demo-sql.mjs --owner-email=you@example.com");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function uuid() {
  return randomUUID();
}

/** SQL string literal, or the literal `null` for null/undefined. */
function s(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** SQL numeric/boolean/timestamp literal passthrough (no quoting). */
function raw(value) {
  return value === null || value === undefined ? "null" : String(value);
}

function ts(date) {
  return s(date.toISOString());
}

function intArrayLiteral(arr) {
  return `'{${arr.join(",")}}'`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function shuffledRange(start, end) {
  const range = [];
  for (let i = start; i <= end; i++) range.push(i);
  return pickN(range, range.length);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// fictional data pools (demo purposes only; no real people or clubs)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Maya", "Liam", "Sofia", "Dev", "Emma", "Noah", "Olivia", "Jack", "Ava",
  "Kai", "Priya", "Owen", "Zoe", "Mateo", "Ines", "Theo", "Nadia", "Finn",
  "Layla", "Caleb", "Ruth", "Amir", "Willa", "Hugo", "Sana", "Leo", "Freya",
  "Tomas", "Grace", "Ezra", "Bianca", "Rowan", "Aisha", "Cole", "Yuki",
  "Marek", "Delphine", "Otis", "Junie", "Arlo",
];

const LAST_NAMES = [
  "Chen", "O'Brien", "Marchetti", "Patel", "Larsen", "Kim", "Reyes",
  "Thompson", "Okafor", "Bergstrom", "Nguyen", "Fontaine", "Ivanov",
  "Delacroix", "Rossi", "Haddad", "Whitfield", "Sato", "Novak", "Klein",
  "Moreau", "Alvarez", "Petrov", "Lindqvist", "Adeyemi", "Bianchi", "Suzuki",
  "Kowalski", "Duarte", "Osei",
];

const CLUBS = [
  "Tripleshot", "UVic Cycling", "Broad Street", "Islands Velo",
  "Harbourside CX", "North Shore Grinders", "Coastal Devo",
  "Ridge Racing Collective", "Ferry Point Flyers", "Independent",
];

const VELODROME_CATEGORIES = ["Senior", "Master", "Junior"];
const CX_CATEGORIES = ["Cat 1/2/3", "Cat 4/5", "Junior"];
const SEXES = ["M", "F", "X"];

function randomSex() {
  // Roughly even split, with the occasional "X" entry.
  const roll = Math.random();
  if (roll < 0.47) return "M";
  if (roll < 0.94) return "F";
  return "X";
}

/** Builds a roster of unique-ish riders for one event. */
function makeRoster(eventId, count, categories, bibRange, checkedInFraction = 0.7) {
  const bibs = shuffledRange(bibRange[0], bibRange[1]).slice(0, count);
  const roster = [];
  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    roster.push({
      id: uuid(),
      event_id: eventId,
      bib: String(bibs[i]),
      first_name: firstName,
      last_name: lastName,
      team: pick(CLUBS),
      category: pick(categories),
      sex: randomSex(),
      checked_in_at: Math.random() < checkedInFraction ? new Date(Date.now() - randInt(5, 90) * 60000) : null,
    });
  }
  return roster;
}

function entryFromParticipant(raceId, participant, overrides = {}) {
  return {
    id: uuid(),
    race_id: raceId,
    bib: participant.bib,
    name: `${participant.first_name} ${participant.last_name}`,
    team: participant.team,
    category: participant.category,
    status: "ok",
    status_reason: null,
    status_set_by: null,
    status_set_at: null,
    ...overrides,
  };
}

/**
 * Generates lap-by-lap crossings for a mass-start race. Every entry gets a
 * random-but-stable pace factor so results look like a real bunched field
 * rather than perfectly even splits.
 */
function generateCrossings({ entries, laps, baseLapSeconds, startTime, dnfBibs = [], dnfAtLapFraction = 0.5 }) {
  const crossings = [];
  for (const entry of entries) {
    if (entry.status === "dns") continue; // never started, no crossings at all

    const paceFactor = 0.965 + Math.random() * 0.09; // ~3.5% spread across the field
    const isDnf = dnfBibs.includes(entry.bib);
    const lapsToRun = isDnf ? Math.max(1, Math.floor(laps * dnfAtLapFraction)) : laps;

    let cumulativeSeconds = 0;
    for (let lap = 1; lap <= lapsToRun; lap++) {
      const lapJitter = 0.985 + Math.random() * 0.03;
      cumulativeSeconds += baseLapSeconds * paceFactor * lapJitter;
      crossings.push({
        id: uuid(),
        race_id: entry.race_id,
        bib: entry.bib,
        client_id: uuid(),
        client_recorded_at: new Date(startTime.getTime() + cumulativeSeconds * 1000),
      });
    }
  }
  return crossings;
}

// ---------------------------------------------------------------------------
// SQL emission
// ---------------------------------------------------------------------------

const sql = [];
const now = Date.now();

function emitEvent(e) {
  sql.push(
    `insert into events (id, owner_id, title, sport_type, location, starts_at, ends_at, timezone, status, description, venue_address, contact_email, registration_url) values (` +
      [
        s(e.id), "v_owner_id", s(e.title), s(e.sport_type), s(e.location),
        e.starts_at ? ts(e.starts_at) : "null",
        e.ends_at ? ts(e.ends_at) : "null",
        s(e.timezone), s(e.status), s(e.description), s(e.venue_address),
        s(e.contact_email), s(e.registration_url),
      ].join(", ") +
      `);`
  );
}

function emitRace(r) {
  sql.push(
    `insert into races (id, event_id, name, sequence_order, laps_planned, status, started_at, finished_at, is_points_race, sprint_interval_laps, sprint_points, final_sprint_multiplier, is_time_trial, time_trial_countdown_seconds) values (` +
      [
        s(r.id), s(r.event_id), s(r.name), raw(r.sequence_order), raw(r.laps_planned),
        s(r.status),
        r.started_at ? ts(r.started_at) : "null",
        r.finished_at ? ts(r.finished_at) : "null",
        raw(r.is_points_race ?? false),
        raw(r.sprint_interval_laps ?? 5),
        intArrayLiteral(r.sprint_points ?? [5, 3, 2, 1]),
        raw(r.final_sprint_multiplier ?? 2),
        raw(r.is_time_trial ?? false),
        raw(r.time_trial_countdown_seconds ?? 5),
      ].join(", ") +
      `);`
  );
}

function emitParticipants(roster) {
  if (roster.length === 0) return;
  const values = roster.map((p) =>
    `(${[s(p.id), s(p.event_id), s(p.bib), s(p.first_name), s(p.last_name), s(p.team), s(p.category), s(p.sex), p.checked_in_at ? ts(p.checked_in_at) : "null"].join(", ")})`
  );
  sql.push(
    `insert into participants (id, event_id, bib, first_name, last_name, team, category, sex, checked_in_at) values\n  ${values.join(",\n  ")};`
  );
}

function emitEntries(entries) {
  if (entries.length === 0) return;
  const values = entries.map((en) =>
    `(${[s(en.id), s(en.race_id), s(en.bib), s(en.name), s(en.team), s(en.category), s(en.status), s(en.status_reason), s(en.status_set_by), en.status_set_at ? ts(en.status_set_at) : "null"].join(", ")})`
  );
  sql.push(
    `insert into entries (id, race_id, bib, name, team, category, status, status_reason, status_set_by, status_set_at) values\n  ${values.join(",\n  ")};`
  );
}

function emitCrossings(crossings) {
  if (crossings.length === 0) return;
  const values = crossings.map((c) => `(${[s(c.id), s(c.race_id), s(c.bib), s(c.client_id), ts(c.client_recorded_at)].join(", ")})`);
  sql.push(`insert into crossings (id, race_id, bib, client_id, client_recorded_at) values\n  ${values.join(",\n  ")};`);
}

function emitPenalty(p) {
  sql.push(
    `insert into race_entry_penalties (entry_id, type, value, reason) values (${[s(p.entry_id), s(p.type), p.value === null ? "null" : raw(p.value), s(p.reason)].join(", ")});`
  );
}

// ---------------------------------------------------------------------------
// Event A: Velodrome, live right now (spectator board demo)
// ---------------------------------------------------------------------------

const eventA = {
  id: uuid(),
  title: "SplitSync Demo: Friday Night Racing",
  sport_type: "velodrome",
  location: "Greater Victoria Velodrome",
  starts_at: new Date(now - 40 * 60000),
  ends_at: new Date(now + 80 * 60000),
  timezone: "America/Vancouver",
  status: "live",
  description: "Weekly Friday night velodrome racing: a scratch race, a points race, and a support B race.",
  venue_address: "1000 Track Lane, Victoria, BC",
  contact_email: "raceoffice@example.com",
  registration_url: "https://example.com/register/friday-night",
};
emitEvent(eventA);

const rosterA = makeRoster(eventA.id, 18, VELODROME_CATEGORIES, [1, 99]);
emitParticipants(rosterA);

// A1: in-progress scratch race (this is what a spectator sees "live" right now).
const raceA1 = {
  id: uuid(),
  event_id: eventA.id,
  name: "A Race — Scratch 20 laps",
  sequence_order: 1,
  laps_planned: 20,
  status: "active",
  started_at: new Date(now - 6 * 60000),
};
emitRace(raceA1);
const entriesA1 = pickN(rosterA, 10).map((p) => entryFromParticipant(raceA1.id, p));
emitEntries(entriesA1);
emitCrossings(
  generateCrossings({
    entries: entriesA1,
    laps: 12, // race is ~60% through its 20 laps
    baseLapSeconds: 18,
    startTime: raceA1.started_at,
  })
);

// A2: finished points race earlier the same night.
const raceA2 = {
  id: uuid(),
  event_id: eventA.id,
  name: "Points Race — 24 laps",
  sequence_order: 2,
  laps_planned: 24,
  status: "finished",
  started_at: new Date(now - 40 * 60000),
  finished_at: new Date(now - 20 * 60000),
  is_points_race: true,
  sprint_interval_laps: 6,
  sprint_points: [5, 3, 2, 1],
  final_sprint_multiplier: 2,
};
emitRace(raceA2);
const entriesA2 = pickN(rosterA, 9).map((p) => entryFromParticipant(raceA2.id, p));
emitEntries(entriesA2);
emitCrossings(
  generateCrossings({
    entries: entriesA2,
    laps: raceA2.laps_planned,
    baseLapSeconds: 17.5,
    startTime: raceA2.started_at,
  })
);

// A3: upcoming B race, roster assigned but not yet started.
const raceA3 = {
  id: uuid(),
  event_id: eventA.id,
  name: "B Race — Scratch 15 laps",
  sequence_order: 3,
  laps_planned: 15,
  status: "upcoming",
};
emitRace(raceA3);
emitEntries(pickN(rosterA, 8).map((p) => entryFromParticipant(raceA3.id, p)));

// ---------------------------------------------------------------------------
// Event B: Cyclocross, fully finished (results page / classification demo)
// ---------------------------------------------------------------------------

const eventB = {
  id: uuid(),
  title: "SplitSync Demo: Fall Classic CX",
  sport_type: "cyclocross",
  location: "Panorama Regional Park",
  starts_at: new Date(now - 3 * 24 * 3600 * 1000),
  ends_at: new Date(now - 3 * 24 * 3600 * 1000 + 5 * 3600 * 1000),
  timezone: "America/Vancouver",
  status: "finished",
  description: "Season-closing cyclocross race day across three categories, run on a muddy 2.8 km course.",
  venue_address: "500 Parkway Drive, Nanaimo, BC",
  contact_email: "raceoffice@example.com",
  registration_url: "https://example.com/register/fall-classic-cx",
};
emitEvent(eventB);

const rosterB = makeRoster(eventB.id, 26, CX_CATEGORIES, [1, 299], 1.0);
emitParticipants(rosterB);

const cat123 = rosterB.filter((p) => p.category === "Cat 1/2/3");
const cat45 = rosterB.filter((p) => p.category === "Cat 4/5");
const juniorsB = rosterB.filter((p) => p.category === "Junior");

function finishedCxRace({ name, sequenceOrder, laps, entrants, baseLapSeconds, dnfBib, dsqBib, startOffsetMinutes }) {
  const race = {
    id: uuid(),
    event_id: eventB.id,
    name,
    sequence_order: sequenceOrder,
    laps_planned: laps,
    status: "finished",
    started_at: new Date(eventB.starts_at.getTime() + startOffsetMinutes * 60000),
  };
  race.finished_at = new Date(race.started_at.getTime() + laps * baseLapSeconds * 1000 + 5 * 60000);
  emitRace(race);

  const entries = entrants.map((p) => {
    if (p.bib === dnfBib) {
      return entryFromParticipant(race.id, p, { status: "dnf", status_reason: "Mechanical, pulled after a broken derailleur.", status_set_by: "system", status_set_at: race.finished_at });
    }
    if (p.bib === dsqBib) {
      return entryFromParticipant(race.id, p, { status: "dsq", status_reason: "Illegal course shortcut on lap 3.", status_set_by: "system", status_set_at: race.finished_at });
    }
    return entryFromParticipant(race.id, p);
  });
  emitEntries(entries);
  emitCrossings(
    generateCrossings({
      entries,
      laps,
      baseLapSeconds,
      startTime: race.started_at,
      dnfBibs: dnfBib ? [dnfBib] : [],
      dnfAtLapFraction: 0.5,
    })
  );

  if (dsqBib) {
    const dsqEntry = entries.find((en) => en.bib === dsqBib);
    emitPenalty({ entry_id: dsqEntry.id, type: "relegation", value: null, reason: "Deviated from the marked course to skip the barriers." });
  }

  // A believable time penalty on a mid-pack rider, independent of the DNF/DSQ.
  const penaltyCandidate = entrants.find((p) => p.bib !== dnfBib && p.bib !== dsqBib);
  if (penaltyCandidate) {
    const penaltyEntry = entries.find((en) => en.bib === penaltyCandidate.bib);
    emitPenalty({ entry_id: penaltyEntry.id, type: "time_penalty", value: 10, reason: "Outside assistance in the pit zone." });
  }
}

finishedCxRace({
  name: "Cat 1/2/3",
  sequenceOrder: 1,
  laps: 6,
  entrants: cat123,
  baseLapSeconds: 330, // ~5.5 min/lap
  dnfBib: cat123[0]?.bib,
  dsqBib: cat123[1]?.bib,
  startOffsetMinutes: 0,
});

finishedCxRace({
  name: "Cat 4/5",
  sequenceOrder: 2,
  laps: 5,
  entrants: cat45,
  baseLapSeconds: 360,
  dnfBib: cat45[0]?.bib,
  dsqBib: null,
  startOffsetMinutes: 75,
});

finishedCxRace({
  name: "Junior",
  sequenceOrder: 3,
  laps: 4,
  entrants: juniorsB,
  baseLapSeconds: 345,
  dnfBib: null,
  dsqBib: null,
  startOffsetMinutes: 150,
});

// ---------------------------------------------------------------------------
// Event C: Velodrome, still in draft (organizer admin setup demo)
// ---------------------------------------------------------------------------

const eventC = {
  id: uuid(),
  title: "SplitSync Demo: Spring Time Trial Series",
  sport_type: "velodrome",
  location: "Greater Victoria Velodrome",
  starts_at: new Date(now + 12 * 24 * 3600 * 1000),
  ends_at: new Date(now + 12 * 24 * 3600 * 1000 + 3 * 3600 * 1000),
  timezone: "America/Vancouver",
  status: "draft",
  description: "Season-opening individual and team pursuit time trials. Roster and start order are being finalized.",
  venue_address: "1000 Track Lane, Victoria, BC",
  contact_email: "raceoffice@example.com",
  registration_url: "https://example.com/register/spring-tt",
};
emitEvent(eventC);

const rosterC = makeRoster(eventC.id, 10, VELODROME_CATEGORIES, [1, 50], 0.2);
emitParticipants(rosterC);

const raceC1 = {
  id: uuid(),
  event_id: eventC.id,
  name: "Individual Pursuit Time Trial",
  sequence_order: 1,
  laps_planned: 12,
  status: "upcoming",
  is_time_trial: true,
  time_trial_countdown_seconds: 10,
};
emitRace(raceC1);
emitEntries(rosterC.map((p) => entryFromParticipant(raceC1.id, p)));

const raceC2 = {
  id: uuid(),
  event_id: eventC.id,
  name: "Team Time Trial",
  sequence_order: 2,
  laps_planned: 8,
  status: "upcoming",
  is_time_trial: true,
  time_trial_countdown_seconds: 15,
};
emitRace(raceC2);

// ---------------------------------------------------------------------------
// wrap everything in one atomic PL/pgSQL block: resolve the owner by email,
// clear any previously-seeded demo events for that owner, then insert.
// ---------------------------------------------------------------------------

const out = `-- Generated by .opencode/skill/seed-demo-data/generate-demo-sql.mjs
-- Demo dataset for owner email: ${ownerEmail.replace(/[\r\n]/g, "")}
-- Safe to re-run: previous "SplitSync Demo:" events for this owner are
-- deleted (cascading to their races/roster/entries/crossings/penalties)
-- before being recreated.

do $$
declare
  v_owner_id text;
begin
  select id::text into v_owner_id from auth.users where lower(email) = lower(${s(ownerEmail)});

  if v_owner_id is null then
    raise exception 'No Supabase auth user found for email %. They must sign in to SplitSync at least once (magic link, Google, or email/password) before demo events can be created for them.', ${s(ownerEmail)};
  end if;

  delete from events where owner_id = v_owner_id and title like 'SplitSync Demo:%';

${sql.map((line) => "  " + line.replace(/\n/g, "\n  ")).join("\n\n")}

  raise notice 'Seeded % demo events for %', 3, ${s(ownerEmail)};
end $$;
`;

process.stdout.write(out);
