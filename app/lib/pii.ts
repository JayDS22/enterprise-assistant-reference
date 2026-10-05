// ponytail: regex only; upgrade to Presidio when the corpus demands it.
// Credit card uses Luhn to cut false positives from phone numbers;
// SSN uses context window to disambiguate from 9-digit account numbers.

export type PIIKind = "email" | "phone" | "ssn" | "credit_card";

export type PIIMatch = {
  kind: PIIKind;
  match: string;
  start: number;
  end: number;
};

// Email: standard pattern. We later filter matches that are (a) a JSON
// object key (quoted string followed by colon) or (b) inside [[wikilinks]].
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Phone: US-style with optional punctuation + E.164.
// The leading `[-.\s]?` only applies after a country-code digit; without
// one, we don't consume a stray separator (would eat preceding whitespace).
const PHONE_US_RE =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const PHONE_E164_RE = /\+\d{10,15}/g;

// SSN: dashed form is unambiguous; bare 9-digit needs context.
const SSN_DASHED_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_BARE_RE = /\b\d{9}\b/g;
const SSN_CONTEXT_RE = /\b(ssn|social security|social)\b/i;
const SSN_CONTEXT_WINDOW = 20;

// Credit card candidate: 13-19 digits, grouped in 4s or contiguous.
// Then Luhn-validated to cut phone-number false positives.
const CC_CANDIDATE_RE = /\b(?:\d{4}[-\s]?){3,4}\d{3,4}\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits[i];
    if (ch === undefined) return false;
    let n = ch.charCodeAt(0) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function isInsideWikilink(text: string, start: number, end: number): boolean {
  // Look for `[[` before start and `]]` after end with no intervening `]]` or `[[`.
  const before = text.lastIndexOf("[[", start);
  if (before === -1) return false;
  const closeBetween = text.indexOf("]]", before);
  if (closeBetween !== -1 && closeBetween < start) return false;
  const after = text.indexOf("]]", end);
  if (after === -1) return false;
  const openBetween = text.indexOf("[[", end);
  if (openBetween !== -1 && openBetween < after) return false;
  return true;
}

function isJsonKey(text: string, start: number, end: number): boolean {
  // Match when the entire email is quoted and followed by ':' — i.e. a JSON key.
  // Pattern we want to reject:  "<email>":  (possibly with whitespace).
  if (start === 0) return false;
  if (text[start - 1] !== '"') return false;
  // Scan forward from end for `"` then optional whitespace then `:`.
  let i = end;
  if (text[i] !== '"') return false;
  i++;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return text[i] === ":";
}

function collect(
  re: RegExp,
  text: string,
  kind: PIIKind,
  accept: (m: RegExpExecArray) => boolean = () => true,
): PIIMatch[] {
  const out: PIIMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (!accept(m)) continue;
    out.push({
      kind,
      match: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function hasSsnContext(text: string, start: number): boolean {
  const windowStart = Math.max(0, start - SSN_CONTEXT_WINDOW);
  return SSN_CONTEXT_RE.test(text.slice(windowStart, start));
}

function overlaps(a: PIIMatch, b: PIIMatch): boolean {
  return a.start < b.end && b.start < a.end;
}

export function detect(text: string): PIIMatch[] {
  const emails = collect(
    EMAIL_RE,
    text,
    "email",
    (m) =>
      !isInsideWikilink(text, m.index, m.index + m[0].length) &&
      !isJsonKey(text, m.index, m.index + m[0].length),
  );

  const phonesUs = collect(PHONE_US_RE, text, "phone");
  const phonesE164 = collect(PHONE_E164_RE, text, "phone");
  // Merge phones; prefer longer match on overlap.
  const phones = mergeOverlaps([...phonesUs, ...phonesE164]);

  const ssnsDashed = collect(SSN_DASHED_RE, text, "ssn");
  const ssnsBare = collect(SSN_BARE_RE, text, "ssn", (m) =>
    hasSsnContext(text, m.index),
  );
  const ssns = [...ssnsDashed, ...ssnsBare];

  const cards = collect(CC_CANDIDATE_RE, text, "credit_card", (m) => {
    const digits = m[0].replace(/[-\s]/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    return luhn(digits);
  });

  // Credit card digits can be swallowed by the phone regex; prefer CC on overlap.
  const all = [...emails, ...ssns, ...cards, ...phones];
  const deduped = dedupeByPriority(all);
  deduped.sort((a, b) => a.start - b.start);
  return deduped;
}

function mergeOverlaps(matches: PIIMatch[]): PIIMatch[] {
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: PIIMatch[] = [];
  for (const m of matches) {
    const last = out[out.length - 1];
    if (last && overlaps(last, m)) {
      // keep the longer one
      if (m.end - m.start > last.end - last.start) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  return out;
}

// Priority: credit_card > ssn > email > phone (when ranges overlap).
const PRIORITY: Record<PIIKind, number> = {
  credit_card: 4,
  ssn: 3,
  email: 2,
  phone: 1,
};

function dedupeByPriority(matches: PIIMatch[]): PIIMatch[] {
  matches.sort((a, b) => a.start - b.start);
  const kept: PIIMatch[] = [];
  for (const m of matches) {
    const clash = kept.findIndex((k) => overlaps(k, m));
    if (clash === -1) {
      kept.push(m);
      continue;
    }
    const existing = kept[clash]!;
    if (PRIORITY[m.kind] > PRIORITY[existing.kind]) {
      kept[clash] = m;
    }
  }
  return kept;
}

export type RedactOptions = {
  replace?: string | ((kind: PIIKind) => string);
};

export function redact(text: string, options: RedactOptions = {}): string {
  const matches = detect(text);
  if (matches.length === 0) return text;
  const { replace } = options;
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.start);
    const rep =
      typeof replace === "function"
        ? replace(m.kind)
        : typeof replace === "string"
          ? replace
          : `[REDACTED_${m.kind.toUpperCase()}]`;
    out += rep;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return out;
}

export function hasPII(text: string): boolean {
  // Short-circuit: detect() already stops at first match conceptually, but
  // the regex engine runs the whole string. For typical chunk sizes this is
  // fine; swap to a cheaper probe if profiling shows it on a hot path.
  // ponytail: full-scan is fine at current chunk sizes; add a cheap-probe
  // fast path if the output guard shows up in flamegraphs.
  return detect(text).length > 0;
}
