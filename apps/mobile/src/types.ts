export type RaceStatus = "upcoming" | "active" | "finished";

export type Event = {
  id: string;
  title: string;
  location: string | null;
  status: "draft" | "live" | "finished";
};

export type Race = {
  id: string;
  event_id: string;
  name: string;
  laps_planned: number | null;
  status: RaceStatus;
  started_at?: string | null;
  finished_at?: string | null;
};

export type Entry = {
  id: string;
  bib: string;
  name: string;
};
