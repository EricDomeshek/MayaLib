// Shared results store: every panel records what it measured, and the Results
// panel exports everything as one JSON report to send back.
import { useEffect, useState } from 'preact/hooks';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const results: Record<string, Record<string, Json>> = {};
const listeners = new Set<() => void>();

export function record(panel: string, key: string, value: Json): void {
  (results[panel] ??= {})[key] = value;
  listeners.forEach((l) => l());
}

export function report(): Record<string, unknown> {
  return {
    spike: 'MayaLib Spike 0',
    build: __BUILD_TIME__,
    at: new Date().toISOString(),
    origin: location.origin,
    userAgent: navigator.userAgent,
    results,
  };
}

export function useResults(): Record<string, Record<string, Json>> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return results;
}

export function errText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t0)];
}
