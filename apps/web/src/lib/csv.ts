// Minimal CSV parser: handles quoted fields (with embedded commas, newlines,
// and escaped "" quotes), \r\n / \n line endings, and a trailing blank line.
// No external dependency — registration CSVs are simple, controlled input
// (bib, name, team, category), not full RFC 4180 documents.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // final field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const HEADER_ALIASES: Record<string, string[]> = {
  bib: ["bib", "bib#", "bib number", "bibnumber", "number", "#"],
  first_name: ["first_name", "first name", "firstname", "first"],
  last_name: ["last_name", "last name", "lastname", "last", "surname"],
  name: ["name", "full name", "fullname", "rider", "rider name"],
  team: ["team", "club", "team/club", "team_club"],
  category: ["category", "cat", "class", "field"],
  sex: ["sex", "gender"],
};

export type CsvColumn = keyof typeof HEADER_ALIASES;

export function matchHeader(header: string): CsvColumn | null {
  const normalized = header.trim().toLowerCase();
  for (const [column, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return column as CsvColumn;
  }
  return null;
}
