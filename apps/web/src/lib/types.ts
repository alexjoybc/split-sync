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
