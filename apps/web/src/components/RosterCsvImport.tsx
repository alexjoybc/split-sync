"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { matchHeader, parseCsv } from "@/lib/csv";
import type { Participant, Race, Sex } from "@/lib/types";

interface ParsedRow {
  line: number;
  bib: string;
  firstName: string;
  lastName: string;
  team: string;
  category: string;
  sex: Sex | "";
  error: string | null;
  duplicateInFile: boolean;
  existsInRoster: boolean;
}

const SEX_VALUES: Sex[] = ["M", "F", "X"];

function splitName(value: string): { firstName: string; lastName: string } {
  const trimmed = value.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function buildRows(csvText: string, existingBibs: Set<string>): ParsedRow[] {
  const table = parseCsv(csvText.trim());
  if (table.length === 0) return [];
  const [headerRow, ...dataRows] = table;
  const columns = headerRow.map(matchHeader);

  const seenBibs = new Set<string>();
  return dataRows
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells, index) => {
      const get = (column: string) => {
        const colIndex = columns.indexOf(column as never);
        return colIndex === -1 ? "" : (cells[colIndex] ?? "").trim();
      };

      const bib = get("bib");
      let firstName = get("first_name");
      let lastName = get("last_name");
      if (!firstName && !lastName) {
        const split = splitName(get("name"));
        firstName = split.firstName;
        lastName = split.lastName;
      }
      const team = get("team");
      const category = get("category");
      const sexRaw = get("sex").toUpperCase();
      const sex = (SEX_VALUES as string[]).includes(sexRaw) ? (sexRaw as Sex) : "";

      let error: string | null = null;
      if (!bib) error = "Missing bib";
      else if (!firstName) error = "Missing name";

      const duplicateInFile = bib !== "" && seenBibs.has(bib);
      if (bib) seenBibs.add(bib);
      const existsInRoster = bib !== "" && existingBibs.has(bib);

      return {
        line: index + 2, // +1 for header, +1 for 1-indexing
        bib,
        firstName,
        lastName,
        team,
        category,
        sex,
        error,
        duplicateInFile,
        existsInRoster,
      };
    });
}

const TEMPLATE_CSV = "bib,first_name,last_name,team,category,sex\n101,Jane,Doe,Local Velo Club,Senior,F\n";

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "splitsync-roster-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function RosterCsvImport({
  eventId,
  participants,
  races,
  onImported,
}: {
  eventId: string;
  participants: Participant[];
  races: Race[];
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [categoryRaceMap, setCategoryRaceMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingBibs = new Set(participants.map((p) => p.bib));
  const upcomingRaces = races.filter((r) => r.status === "upcoming");

  const importableRows = rows.filter((r) => !r.error && !r.duplicateInFile && !r.existsInRoster);
  const categories = Array.from(new Set(importableRows.map((r) => r.category).filter(Boolean)));

  const handleFile = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setSummary(null);
    setRows(buildRows(text, existingBibs));
    setCategoryRaceMap({});
  };

  const reset = () => {
    setRows([]);
    setFileName("");
    setCategoryRaceMap({});
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runImport = async () => {
    if (importableRows.length === 0) return;
    setImporting(true);

    const { data: inserted, error } = await supabase
      .from("participants")
      .insert(
        importableRows.map((row) => ({
          event_id: eventId,
          bib: row.bib,
          first_name: row.firstName,
          last_name: row.lastName || null,
          team: row.team || null,
          category: row.category || null,
          sex: row.sex || null,
        }))
      )
      .select();

    if (error || !inserted) {
      setImporting(false);
      setSummary(`Import failed: ${error?.message ?? "unknown error"}`);
      return;
    }

    // Optional: assign imported riders into races by mapped category.
    const entryRows = inserted
      .filter((p) => p.category && categoryRaceMap[p.category])
      .map((p) => ({
        race_id: categoryRaceMap[p.category as string],
        bib: p.bib,
        name: [p.first_name, p.last_name].filter(Boolean).join(" "),
        team: p.team,
        category: p.category,
      }));

    if (entryRows.length > 0) {
      // upsert + ignoreDuplicates: guards against a leftover entries row
      // still occupying (race_id, bib) for a bib that was freed up on the
      // roster and is now being re-imported (see issue #127).
      await supabase.from("entries").upsert(entryRows, { onConflict: "race_id,bib", ignoreDuplicates: true });
    }

    setImporting(false);
    setSummary(
      `Imported ${inserted.length} racer${inserted.length === 1 ? "" : "s"}` +
        (entryRows.length > 0 ? `, assigned ${entryRows.length} to races` : "") +
        "."
    );
    reset();
    onImported();
  };

  const skippedCount = rows.length - importableRows.length;

  return (
    <div className="mt-4 border-t border-race-line pt-4">
      <button onClick={() => setOpen(!open)} className="race-action--muted race-action--outline">
        {open ? "Hide CSV import" : "Import from CSV"}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-race-muted">
            Import a registration list for CX fields with many riders. Columns: <code>bib</code>,{" "}
            <code>first_name</code>/<code>last_name</code> (or a single <code>name</code>), <code>team</code>,{" "}
            <code>category</code>, <code>sex</code> (optional). First row must be a header.{" "}
            <button onClick={downloadTemplate} className="underline decoration-2 underline-offset-4">
              Download template
            </button>
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="race-input--muted !w-auto"
          />

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
                <span>{fileName}</span>
                <span className="text-race-muted">
                  {importableRows.length} ready to import
                  {skippedCount > 0 ? `, ${skippedCount} skipped` : ""}
                </span>
              </div>

              <div className="max-h-72 overflow-y-auto overflow-x-hidden border-t-2 border-race-ink">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-race-line text-left text-[10px] font-black uppercase tracking-wide text-race-muted">
                      <th className="w-10 py-2">Row</th>
                      <th className="w-14 py-2">Bib</th>
                      <th className="py-2">Name</th>
                      <th className="w-28 py-2">Team</th>
                      <th className="w-24 py-2">Category</th>
                      <th className="w-32 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const skip = row.error || row.duplicateInFile || row.existsInRoster;
                      const status = row.error
                        ? row.error
                        : row.duplicateInFile
                          ? "Duplicate in file"
                          : row.existsInRoster
                            ? "Bib already in roster"
                            : "Ready";
                      return (
                        <tr key={row.line} className="border-b border-race-line even:bg-race-panel-alt">
                          <td className="py-1 text-race-muted">{row.line}</td>
                          <td className="py-1 font-black tabular-nums">{row.bib || "—"}</td>
                          <td className="truncate py-1 font-bold">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="truncate py-1 text-race-muted">{row.team || "—"}</td>
                          <td className="truncate py-1 text-race-muted">{row.category || "—"}</td>
                          <td className={`py-1 text-xs font-black uppercase ${skip ? "text-race-red" : "text-race-muted"}`}>
                            {status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {categories.length > 0 && upcomingRaces.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wide">Map categories to races (optional)</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {categories.map((category) => (
                      <label key={category} className="flex items-center gap-2 text-sm font-bold">
                        <span className="w-28 truncate">{category}</span>
                        <select
                          value={categoryRaceMap[category as string] ?? ""}
                          onChange={(e) =>
                            setCategoryRaceMap({ ...categoryRaceMap, [category as string]: e.target.value })
                          }
                          className="race-input--muted"
                        >
                          <option value="">Don&apos;t assign</option>
                          {upcomingRaces.map((race) => (
                            <option key={race.id} value={race.id}>
                              {race.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={runImport}
                  disabled={importing || importableRows.length === 0}
                  className="race-action--muted disabled:opacity-50"
                >
                  {importing ? "Importing…" : `Import ${importableRows.length} racer${importableRows.length === 1 ? "" : "s"}`}
                </button>
                <button onClick={reset} className="text-xs font-black uppercase text-race-muted hover:text-race-ink">
                  Clear
                </button>
              </div>
            </>
          )}

          {summary && <p className="text-sm font-bold">{summary}</p>}
        </div>
      )}
    </div>
  );
}
