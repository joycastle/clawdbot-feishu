export type PerfMarks = Record<string, number>;

export function nowMs(): number {
  return Date.now();
}

export function fmtMs(ms: number): string {
  return `${ms}ms`;
}

export function perfStart(): PerfMarks {
  return { start: nowMs() };
}

export function perfMark(marks: PerfMarks, key: string): number {
  const t = nowMs();
  marks[key] = t;
  return t;
}

export function perfSince(marks: PerfMarks, key: string): number | null {
  const base = marks[key];
  if (typeof base !== 'number') return null;
  return nowMs() - base;
}

export function perfDelta(marks: PerfMarks, from: string, to: string): number | null {
  const a = marks[from];
  const b = marks[to];
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return b - a;
}

export function buildPerfSummary(marks: PerfMarks, keys: string[]): string {
  const parts: string[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    const d = perfDelta(marks, keys[i - 1], keys[i]);
    if (d != null) parts.push(`${keys[i - 1]}→${keys[i]}=${fmtMs(d)}`);
  }
  const total = perfSince(marks, 'start');
  if (total != null) parts.push(`total=${fmtMs(total)}`);
  return parts.join(' ');
}
