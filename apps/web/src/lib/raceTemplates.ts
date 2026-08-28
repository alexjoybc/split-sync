export interface RaceTemplate {
  id: string;
  label: string;
  sport: "Cyclocross" | "Velodrome" | "General";
  description: string;
  suggestedName: string;
  /** Default lap count, or null for a timed/open-ended race. */
  defaultLaps: number | null;
  /** Suggested duration in minutes, shown when the race is timed rather than lap-based. */
  suggestedDurationMinutes?: number;
  suggestedCategories: string[];
  /** When true, this template pre-selects the time trial mode. */
  isTimeTrial?: boolean;
}

/**
 * Static catalog of race templates. Selecting a template only pre-fills the
 * "add race" form defaults — nothing here is persisted, and every field
 * remains editable before the race is created or started.
 */
export const raceTemplates: RaceTemplate[] = [
  {
    id: "cyclocross-lap",
    label: "Cyclocross lap race",
    sport: "Cyclocross",
    description: "Fixed-lap mass start on a closed cyclocross course. Riders are classified by laps completed and finish order.",
    suggestedName: "Cyclocross Race",
    defaultLaps: 6,
    suggestedCategories: ["Cat 1/2/3", "Cat 4/5", "Junior", "Master"],
  },
  {
    id: "velodrome-scratch",
    label: "Velodrome scratch race",
    sport: "Velodrome",
    description: "Mass start on the track over a fixed number of laps. First rider across the line after the final lap wins.",
    suggestedName: "Scratch Race",
    defaultLaps: 20,
    suggestedCategories: ["Senior", "Master", "Junior"],
  },
  {
    id: "velodrome-points",
    label: "Velodrome points race",
    sport: "Velodrome",
    description: "Mass start with sprint points awarded at set lap intervals in addition to overall finish order.",
    suggestedName: "Points Race",
    defaultLaps: 30,
    suggestedCategories: ["Senior", "Master"],
  },
  {
    id: "fixed-lap-mass-start",
    label: "Fixed-lap mass-start race",
    sport: "General",
    description: "Generic fixed-lap mass start for road, gravel, or other closed-circuit racing.",
    suggestedName: "Mass-Start Race",
    defaultLaps: 10,
    suggestedCategories: ["Open"],
  },
  {
    id: "timed-mass-start",
    label: "Timed mass-start race",
    sport: "General",
    description: "Mass start with no fixed lap count — the race runs for a set duration and riders are classified by laps completed when time expires.",
    suggestedName: "Timed Race",
    defaultLaps: null,
    suggestedDurationMinutes: 45,
    suggestedCategories: ["Open"],
  },
  {
    id: "time-trial",
    label: "Time trial",
    sport: "General",
    description: "Solo start/finish timing — riders go one at a time and are ranked by elapsed time.",
    suggestedName: "Time Trial",
    defaultLaps: null,
    suggestedCategories: ["Open"],
    isTimeTrial: true,
  },
];
