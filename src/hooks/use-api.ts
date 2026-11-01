"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny fetch hook with derived loading state and manual reload. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  /** Monotonic request generation — a fetch superseded by a newer URL/reload is discarded. */
  const genRef = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (gen !== genRef.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as T);
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
