// updates.txt — the request file the Oracle writes in MyComputer and the
// owner sends to the repo's updates/ folder, where .github/workflows/
// updates-to-pr.yml turns new lines into a Claude-authored PR that CodeRabbit
// reviews. Shared by the browser (panel, downloads) and the /api/updates route.

export const UPDATES_FILE = "updates.txt";
export const UPDATES_REPO_PATH = "updates/updates.txt";

const CHECKBOX_RE = /^\s*\[( |x|X)\]\s*/;

export type UpdateItem = { text: string; done: boolean };

// Request lines only — skips blanks, "#" comments and the bot's "-> bot:" notes.
export function parseUpdateItems(text: string): UpdateItem[] {
  const items: UpdateItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("->")) continue;
    const m = CHECKBOX_RE.exec(line);
    items.push({ text: line.replace(CHECKBOX_RE, ""), done: Boolean(m && m[1].toLowerCase() === "x") });
  }
  return items;
}

function normalizeRequest(line: string): string {
  return line.replace(CHECKBOX_RE, "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Lines in `incoming` whose request isn't already in `existing` (checked or
// not), normalized to "[ ] ..." — so re-sending a file only appends what's new
// and the bot's diff-based run implements just that.
export function newRequestLines(existing: string, incoming: string): string[] {
  const seen = new Set(parseUpdateItems(existing).map((i) => normalizeRequest(i.text)));
  const out: string[] = [];
  for (const item of parseUpdateItems(incoming)) {
    if (item.done) continue;
    const key = normalizeRequest(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(`[ ] ${item.text}`);
  }
  return out;
}

// ── Minimal text-only PDF writer (no dependency) ────────────────────────────
// Helvetica + WinAnsiEncoding covers Spanish accents/ñ; anything outside
// Latin-1 degrades to "?". Good enough for a list of requests.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const FONT_SIZE = 11;
const LEADING = 16;
const WRAP_CHARS = 88;

function toLatin1(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 63;
    out += code < 256 ? ch : "?";
  }
  return out;
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line: string): string[] {
  if (line.length <= WRAP_CHARS) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if ((current + " " + word).trim().length > WRAP_CHARS && current) {
      out.push(current);
      current = "    " + word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

export function buildUpdatesPdf(title: string, text: string): Uint8Array {
  const lines = [title, "", ...text.split(/\r?\n/).flatMap(wrap)].map(toLatin1);
  const perPage = Math.floor((PAGE_H - MARGIN * 2) / LEADING);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([""]);

  // Object layout: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  pages.forEach((pageLines, i) => {
    const ops = [`BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN} Td`];
    pageLines.forEach((l, j) => {
      const isTitle = i === 0 && j === 0;
      if (isTitle) ops.push(`/F1 15 Tf (${pdfEscape(l)}) Tj /F1 ${FONT_SIZE} Tf T*`);
      else ops.push(`(${pdfEscape(l)}) Tj T*`);
    });
    ops.push("ET");
    const stream = ops.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
