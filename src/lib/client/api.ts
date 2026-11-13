"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** fetch wrapper: JSON in/out, throws ApiClientError with the server's Thai message. */
export async function api<T = unknown>(url: string, init: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; details?: unknown };
    // Only an expired/missing session redirects; e.g. wrong-password 401s must surface their message.
    if (res.status === 401 && d.code === "unauthenticated" && typeof window !== "undefined") window.location.assign("/login?expired=1");
    throw new ApiClientError(d.error ?? `HTTP ${res.status}`, res.status, d.code, d.details);
  }
  return data as T;
}

/** Minimal data hook with loading/error state and optional polling. */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const my = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const d = await api<T>(url);
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (my === seq.current) setError(e as Error);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on url change
    void load();
  }, [load]);

  useEffect(() => {
    if (!opts.refreshMs || !url) return;
    const t = setInterval(() => void load(true), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, url, load]);

  return { data, error, loading, reload: () => load(true), setData };
}
