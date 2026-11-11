/**
 * Parses CSV text into an array of rows (arrays of strings).
 * The first row is usually a header; parseRecords turns rows into objects.
 */
export function parseCSV(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    rows.push(line.split(",").map((cell) => cell.trim()));
  }
  return rows;
}

/** Turns CSV text with a header row into objects keyed by the header names */
export function parseRecords(text) {
  const [header, ...rows] = parseCSV(text);
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])));
}
