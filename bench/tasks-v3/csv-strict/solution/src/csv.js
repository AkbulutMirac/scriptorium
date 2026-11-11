const isSpace = (c) => c === " " || c === "\t";

/**
 * Parses CSV text into records [{ line, cells }]: fields separated by commas, records by \n or \r\n, fields may be
 * quoted ("" is a quote inside quotes). Unquoted fields are trimmed and blank lines skipped.
 */
export function parseRows(text) {
  const rows = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const start = line;
    const cells = [];
    let quoted = false;
    for (;;) {
      let j = i;
      while (j < n && isSpace(text[j])) j++;
      if (text[j] === '"') {
        quoted = true;
        const from = line;
        let value = "";
        j++;
        for (;;) {
          if (j >= n) throw new SyntaxError(`Unterminated quote on line ${from}`);
          if (text[j] === '"') {
            if (text[j + 1] === '"') {
              value += '"';
              j += 2;
              continue;
            }
            j++;
            break;
          }
          if (text[j] === "\n") line++;
          value += text[j++];
        }
        while (j < n && isSpace(text[j])) j++;
        if (text[j] === "\r" && text[j + 1] === "\n") j++;
        if (j < n && text[j] !== "," && text[j] !== "\n") throw new SyntaxError(`Unexpected character after quote on line ${line}`);
        cells.push(value);
        i = j;
      } else {
        let k = i;
        while (k < n && text[k] !== "," && text[k] !== "\n") k++;
        cells.push(text.slice(i, k).trim());
        i = k;
      }
      if (i < n && text[i] === ",") {
        i++;
        continue;
      }
      break;
    }
    if (i < n) {
      i++;
      line++;
    }
    if (!quoted && cells.length === 1 && cells[0] === "") continue;
    rows.push({ line: start, cells });
  }
  return rows;
}

/** Parses CSV text into an array of rows (arrays of strings) */
export function parseCSV(text) {
  return parseRows(text).map((r) => r.cells);
}

/** Turns CSV text with a header row into objects keyed by the header names */
export function parseRecords(text) {
  const [header, ...rows] = parseCSV(text);
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])));
}
