export type RaceStatus = "upcoming" | "active" | "finished";

export interface Race {
  id: string;
  event_id: string;
  name: string;
  sequence_order: number;
  laps_planned: number | null;
  status: RaceStatus;
  started_at: string | null;
}

export interface Entry {
  id: string;
  race_id: string;
  bib: string;
  name: string;
  team: string | null;
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

export interface EventRow {
  id: string;
  title: string;
  sport_type: string;
  location: string | null;
  status: string;
}
