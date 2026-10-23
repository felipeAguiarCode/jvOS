import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** Reads and validates a JSON value from localStorage; null when missing, corrupt or unavailable. */
export function readJson<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const stored = localStorage.getItem(key);
    return stored ? parse(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable or full. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * React state mirrored to localStorage after a short pause (and before the page unloads).
 * The initialiser is pure, so StrictMode's double call is harmless.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null,
  delay = 250,
): [T, Dispatch<SetStateAction<T>>, { quotaExceeded: boolean }] {
  const [value, setValue] = useState<T>(() => readJson(key, parse) ?? fallback);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const latest = useRef(value);
  const pending = useRef(false);
  const mounted = useRef(false);
  latest.current = value;

  useEffect(() => {
    // The stored value itself: nothing to write back.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    pending.current = true;
    const timer = window.setTimeout(() => {
      pending.current = false;
      setQuotaExceeded(!writeJson(key, latest.current));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, value, delay]);

  useEffect(() => {
    const flush = () => {
      if (pending.current) writeJson(key, latest.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [key]);

  return [value, setValue, { quotaExceeded }];
}
