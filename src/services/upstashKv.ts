/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KAISO INTELLIGENCE OS — Upstash Redis (REST) minimal client
 * src/services/upstashKv.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SERVER-ONLY. A tiny, dependency-free wrapper over the Upstash Redis REST API
 * (native `fetch` only — NO @upstash/redis package). Its sole job is to give the
 * quota/cooldown gates DURABLE state that survives Render's ephemeral disk.
 *
 * DESIGN CONTRACT
 * ---------------
 *   • Activates only when BOTH UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 *     are set (see `isConfigured`). Otherwise callers fall back to /tmp files.
 *   • NON-FATAL by construction: every helper returns null/false on a missing
 *     config, a non-OK response, a timeout, or a network error — it NEVER throws.
 *     A returned `null` means "Upstash unavailable — use the local fallback".
 *
 * REST PROTOCOL: POST {URL} with a JSON array body `["INCR","key"]`, bearer-auth.
 * Success → `{ "result": <value> }`; failure → `{ "error": "..." }`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const REQUEST_TIMEOUT_MS = 5_000;

function restUrl(): string {
  return process.env.UPSTASH_REDIS_REST_URL ?? '';
}

function restToken(): string {
  return process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
}

/** True only when both REST credentials are present. Resolved at call time. */
export function isConfigured(): boolean {
  return Boolean(restUrl()) && Boolean(restToken());
}

/**
 * Run a single Redis command via the REST API. Returns the parsed `result` on
 * success, or null on ANY failure (unconfigured, timeout, network, non-OK, or an
 * `error` payload) so callers can fall back to local state.
 */
async function command(args: (string | number)[]): Promise<unknown | null> {
  if (!isConfigured()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(restUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[Upstash] HTTP ${response.status} for ${String(args[0])}.`);
      return null;
    }
    const data = (await response.json()) as { result?: unknown; error?: string };
    if (data?.error) {
      console.warn(`[Upstash] Command error for ${String(args[0])}: ${data.error}`);
      return null;
    }
    return data?.result ?? null;
  } catch (err) {
    console.warn(`[Upstash] Request failed for ${String(args[0])}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Atomic INCR. Returns the new counter value, or null if Upstash is unavailable. */
export async function kvIncr(key: string): Promise<number | null> {
  const result = await command(['INCR', key]);
  return typeof result === 'number' ? result : null;
}

/** Set a TTL (seconds) on a key. Returns true if applied, false/null otherwise. */
export async function kvExpire(key: string, seconds: number): Promise<boolean> {
  const result = await command(['EXPIRE', key, Math.max(1, Math.floor(seconds))]);
  return result === 1;
}

/** SET key=value with an expiry (seconds). Returns true on success. */
export async function kvSetEx(key: string, value: string, seconds: number): Promise<boolean> {
  const result = await command(['SET', key, value, 'EX', Math.max(1, Math.floor(seconds))]);
  return result === 'OK';
}

/**
 * EXISTS check. Returns true/false when Upstash answers, or null when it is
 * unavailable (so callers can distinguish "definitely absent" from "unknown").
 */
export async function kvExists(key: string): Promise<boolean | null> {
  const result = await command(['EXISTS', key]);
  return typeof result === 'number' ? result === 1 : null;
}
