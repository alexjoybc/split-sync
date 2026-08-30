export type RaceStatus = "upcoming" | "active" | "finished";

export interface Race {
  id: string;
  event_id: string;
  name: string;
  sequence_order: number;
  laps_planned: number | null;
  status: RaceStatus;
  started_at: string | null;
  finished_at: string | null;
  // Result finalization/publishing (see docs/adr/0018-race-result-finalization.md).
  // Both are written only by finalize_and_publish_race()/reopen_race() — never
  // directly by a client.
  results_published_at: string | null;
  results_under_revision: boolean;
  // Velodrome points race scoring config (see apps/web/src/lib/pointsRace.ts).
  // Meaningless when is_points_race is false.
  is_points_race: boolean;
  sprint_interval_laps: number;
  sprint_points: number[];
  final_sprint_multiplier: number;
  lap_gain_bonus: number;
  lap_loss_penalty: number;
  // Time trial config (see docs/adr/0014-time-trial-race-type.md).
  // Meaningless when is_time_trial is false.
  is_time_trial: boolean;
  time_trial_countdown_seconds: number;
}

export interface RaceStatusChange {
  id: string;
  race_id: string;
  previous_status: RaceStatus;
  new_status: RaceStatus;
  reason: string | null;
  actor: string;
  created_at: string;
}

export type EntryStatus = "ok" | "dns" | "dnf" | "dsq";

export interface Entry {
  id: string;
  race_id: string;
  bib: string;
  name: string;
  team: string | null;
  category: string | null;
  status: EntryStatus;
  status_reason: string | null;
  status_set_by: string | null;
  status_set_at: string | null;
}

export interface EntryStatusChange {
  id: string;
  entry_id: string;
  previous_status: EntryStatus;
  new_status: EntryStatus;
  reason: string | null;
  actor: string;
  created_at: string;
}

export type PenaltyType = "time_penalty" | "lap_penalty" | "relegation" | "note";

// entry_id, not race_id: penalties/adjustments are per race-entry, same
// scope as EntryStatus. Unlike status (one current value + history), an
// entry can carry several stacked penalties, so this is the record itself,
// not an audit log of it.
export interface EntryPenalty {
  id: string;
  entry_id: string;
  type: PenaltyType;
  value: number | null; // seconds for time_penalty, laps for lap_penalty; null for relegation/note
  reason: string;
  set_by: string;
  set_at: string;
}

export type Sex = "M" | "F" | "X";

export interface Participant {
  id: string;
  event_id: string;
  bib: string;
  first_name: string;
  last_name: string | null;
  team: string | null;
  category: string | null;
  sex: Sex | null;
  checked_in_at: string | null;
}

export interface Crossing {
  id: string;
  race_id: string;
  bib: string;
  client_id: string;
  recorded_at: string;
  client_recorded_at: string;
  deleted_at: string | null;
}

export type CrossingCorrectionField = "bib" | "client_recorded_at" | "deleted_at";

export interface CrossingCorrection {
  id: string;
  crossing_id: string;
  field_changed: CrossingCorrectionField;
  previous_value: string | null;
  new_value: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

export type EventMemberRole = "organizer" | "scorer" | "checkin" | "official";

// Access resolved for the signed-in user against a single event: the literal
// event owner, an accepted event_members role, or none.
export type EventAccessRole = "owner" | EventMemberRole | null;

export interface EventMember {
  id: string;
  event_id: string;
  user_id: string;
  role: EventMemberRole;
  invited_by: string | null;
  created_at: string;
}

export interface EventInvite {
  id: string;
  event_id: string;
  role: EventMemberRole;
  token: string;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  title: string;
  sport_type: string;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  venue_address: string | null;
  description: string | null;
  banner_image_url: string | null;
  contact_email: string | null;
  registration_url: string | null;
  status: string;
  owner_id: string | null;
}
