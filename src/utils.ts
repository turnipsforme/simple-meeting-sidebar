import type { TextUpdateResult } from "./models";

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*$/;
const EMOJI_RE = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?(?:\p{Emoji_Modifier})?)*)/gu;

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeVaultFolder(value: string, fallback: string): string {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

export function stripEmojis(value: string): string {
  return value
    .replace(EMOJI_RE, "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeMeetingTitle(value: string): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\\/:*?"<>|#[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, 160)
    .trim();
  return cleaned || "Untitled meeting";
}

export function nextMeetingBasename(base: string, existingBasenames: readonly string[]): string {
  const escaped = escapeRegExp(base);
  const pattern = new RegExp(`^${escaped}(?: (\\d+))?$`, "i");
  let maximum = 0;

  for (const basename of existingBasenames) {
    const match = pattern.exec(basename);
    if (!match) continue;
    const parsed = match[1] ? Number.parseInt(match[1], 10) : 1;
    if (Number.isFinite(parsed)) maximum = Math.max(maximum, parsed);
  }

  return maximum === 0 ? base : `${base} ${maximum + 1}`;
}

export function normalizePersonText(value: string): string {
  return (value.normalize("NFKD").replace(/\p{M}+/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [])
    .join(" ")
    .toLocaleLowerCase();
}

export function findLongestPersonKey(
  eventTitle: string,
  candidates: ReadonlyMap<string, unknown>,
  maximumCandidateTokens: number,
): string | null {
  const normalized = normalizePersonText(eventTitle);
  if (!normalized) return null;
  const tokens = normalized.split(" ");
  const longest = Math.min(tokens.length, maximumCandidateTokens);

  for (let length = longest; length >= 1; length -= 1) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      const candidate = tokens.slice(start, start + length).join(" ");
      if (candidates.has(candidate)) return candidate;
    }
  }

  return null;
}

export function makeEventKey(event: {
  id: string;
  title: string;
  start: string;
  end: string;
  calendar: string;
}): string {
  return [event.id, event.calendar, event.start, event.end, event.title].join("\u001F");
}

export function insertTaskIntoDailyNote(content: string, title: string): TextUpdateResult {
  const { lines, eol } = splitLines(content);
  const safeTitle = title.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim()
    || "Untitled event";
  const taskLine = `- [ ] ${safeTitle}`;
  const taskPattern = new RegExp(`^\\s*-\\s*\\[[ xX-]\\]\\s*${escapeRegExp(safeTitle)}\\s*$`);

  if (lines.some((line) => taskPattern.test(line))) {
    return { content, changed: false };
  }

  const headingIndex = lines.findIndex((line) => {
    const match = HEADING_RE.exec(line);
    return Boolean(match?.[2] && /\btasks?\b/i.test(match[2]));
  });

  if (headingIndex >= 0) {
    const headingMatch = HEADING_RE.exec(lines[headingIndex] ?? "");
    const headingLevel = headingMatch?.[1]?.length ?? 6;
    const sectionEnd = findSectionEnd(lines, headingIndex, headingLevel);
    const emptyTaskIndex = lines.findIndex(
      (line, index) =>
        index > headingIndex && index < sectionEnd && /^\s*-\s*\[\s*\]\s*$/.test(line),
    );

    if (emptyTaskIndex >= 0) {
      lines[emptyTaskIndex] = taskLine;
    } else {
      let insertAt = sectionEnd;
      while (insertAt > headingIndex + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
        insertAt -= 1;
      }
      lines.splice(insertAt, 0, taskLine);
    }
  } else {
    const firstHeading = lines.findIndex((line) => HEADING_RE.test(line));
    const block = ["", "### Tasks", taskLine, ""];
    if (firstHeading >= 0) {
      lines.splice(firstHeading + 1, 0, ...block);
    } else {
      lines.unshift("### Tasks", taskLine, "");
    }
  }

  return { content: lines.join(eol), changed: true };
}

export function insertMeetingLinkIntoDailyNote(content: string, markdownLink: string): TextUpdateResult {
  if (content.includes(markdownLink)) return { content, changed: false };

  const { lines, eol } = splitLines(content);
  const meetingParentPattern = /^(\s*)-\s*(?:[^\p{L}\p{N}]*)?meetings?\s*:?\s*$/iu;
  const parentIndex = lines.findIndex((line) => meetingParentPattern.test(line));

  if (parentIndex >= 0) {
    const parentMatch = meetingParentPattern.exec(lines[parentIndex] ?? "");
    const parentIndent = indentationWidth(parentMatch?.[1] ?? "");
    let blockEnd = parentIndex + 1;
    let childIndent = `${parentMatch?.[1] ?? ""}\t`;

    while (blockEnd < lines.length) {
      const line = lines[blockEnd] ?? "";
      if (line.trim() === "") {
        blockEnd += 1;
        continue;
      }
      const leading = /^\s*/.exec(line)?.[0] ?? "";
      if (indentationWidth(leading) <= parentIndent) break;
      if (childIndent.endsWith("\t")) childIndent = leading;
      blockEnd += 1;
    }

    while (blockEnd > parentIndex + 1 && (lines[blockEnd - 1] ?? "").trim() === "") {
      blockEnd -= 1;
    }
    lines.splice(blockEnd, 0, `${childIndent}- ${markdownLink}`);
  } else {
    const firstHeading = lines.findIndex((line) => HEADING_RE.test(line));
    if (firstHeading >= 0) {
      lines.splice(firstHeading + 1, 0, `- ${markdownLink}`);
    } else {
      lines.unshift(`- ${markdownLink}`);
    }
  }

  return { content: lines.join(eol), changed: true };
}

export function parseDailyTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? "", 10);
  const minutes = Number.parseInt(match[2] ?? "", 10);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function findSectionEnd(lines: readonly string[], headingIndex: number, headingLevel: number): number {
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const match = HEADING_RE.exec(lines[index] ?? "");
    if (match?.[1] && match[1].length <= headingLevel) return index;
  }
  return lines.length;
}

function splitLines(content: string): { lines: string[]; eol: string } {
  return { lines: content.split(/\r?\n/), eol: content.includes("\r\n") ? "\r\n" : "\n" };
}

function indentationWidth(value: string): number {
  let width = 0;
  for (const character of value) width += character === "\t" ? 4 : 1;
  return width;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
