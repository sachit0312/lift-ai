# Batch 1: MCP Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three exploitable holes in the MCP server: forgeable JWTs, cross-request user-ID bleed in Cloudflare Workers, and a ghost-row filter that diverges from the phone app's canonical sentinel.

**Architecture:**
- JWT signature verification via [`jose`](https://github.com/panva/jose) (Web Crypto, Workers-native, no Node deps).
- Per-request context propagation via Node `AsyncLocalStorage` (already enabled via `nodejs_compat` in `wrangler.toml`). Eliminates all module-level mutables (`currentRequestContext`, `_supabase`, `globalThis.SUPABASE_URL`).
- Ghost-row detection extracted to a single shared predicate that matches `supabase/migrations/013_workout_ordering_integrity.sql` exactly.

**Tech Stack:** TypeScript, Cloudflare Workers, `jose`, `@supabase/supabase-js`, Jest + ts-jest.

**Repo:** `/Users/sachitgoyal/code/lift-ai-mcp/` (NOT this worktree — implement directly in the MCP repo).

---

## File Structure

**New files:**
- `src/tools/ghostRow.ts` — `isGhostRow(set)` predicate + types
- `src/context.ts` — `AsyncLocalStorage`-backed request context (replaces module-level state in `shared.ts` + `worker.ts`)
- `src/__tests__/auth.test.ts` — JWT signature verification tests
- `src/__tests__/context.test.ts` — concurrent-request isolation tests
- `src/__tests__/ghostRow.test.ts` — sentinel coverage tests

**Modified files:**
- `package.json` — add `jose` dep
- `src/auth.ts` — async `validateToken`/`validateAuthHeader` with signature check
- `src/worker.ts` — pass JWT secret; wrap request in ALS; remove `currentRequestContext` + `globalThis` writes
- `src/supabase.ts` — accept config from ALS; remove module-level `_supabase` singleton
- `src/tools/shared.ts` — delegate `getCurrentContext` to `src/context.ts`; drop `setContextProvider` for HTTP path (stdio default kept)
- `src/tools/read/workouts.ts` — use `isGhostRow`
- `src/tools/read/exercises.ts` — apply `isGhostRow` to `get_exercise_history`, drop empty sessions
- `.dev.vars` — add `SUPABASE_JWT_SECRET` (user action)

---

## Task 1: Add `jose` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jose**

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
npm install jose@^5.9.6
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(mcp): add jose for JWT signature verification"
```

---

## Task 2: Extract `isGhostRow` predicate

**Files:**
- Create: `src/tools/ghostRow.ts`
- Test: `src/__tests__/ghostRow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ghostRow.test.ts`:

```typescript
import { isGhostRow } from '../tools/ghostRow.js';

describe('isGhostRow', () => {
  const base = {
    set_number: 1,
    reps: 0,
    weight: 0,
    is_completed: false,
    exercise_order: 0,
    programmed_order: 5,
  };

  it('returns true for the canonical sentinel (composite match)', () => {
    expect(isGhostRow(base)).toBe(true);
  });

  it('returns false when programmed_order is null (not a planned exercise)', () => {
    expect(isGhostRow({ ...base, programmed_order: null })).toBe(false);
  });

  it('returns false when exercise_order > 0 (a real performed set)', () => {
    expect(isGhostRow({ ...base, exercise_order: 1 })).toBe(false);
  });

  it('returns false when is_completed', () => {
    expect(isGhostRow({ ...base, is_completed: true })).toBe(false);
  });

  it('returns false when reps > 0', () => {
    expect(isGhostRow({ ...base, reps: 5 })).toBe(false);
  });

  it('returns false when weight > 0', () => {
    expect(isGhostRow({ ...base, weight: 100 })).toBe(false);
  });

  it('handles null/undefined reps and weight as 0', () => {
    expect(isGhostRow({ ...base, reps: null, weight: null })).toBe(true);
    expect(isGhostRow({ ...base, reps: undefined as any, weight: undefined as any })).toBe(true);
  });

  it('does NOT require set_number === 1 (multi-ghost scenarios)', () => {
    expect(isGhostRow({ ...base, set_number: 2 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPattern=ghostRow`
Expected: FAIL — `Cannot find module '../tools/ghostRow.js'`

- [ ] **Step 3: Implement the predicate**

Create `src/tools/ghostRow.ts`:

```typescript
/**
 * Ghost-row predicate. Mirrors the phone app's canonical composite sentinel
 * documented in supabase/migrations/013_workout_ordering_integrity.sql and
 * in lift-ai/CLAUDE.md ("Gotchas: Ghost rows are NOT identified by
 * exercise_order IS NULL").
 *
 * A ghost row is a planned-but-skipped exercise placeholder, inserted at
 * finish time by insertSkippedPlaceholderSets. It satisfies ALL of:
 *   - programmed_order IS NOT NULL  (it was in the plan)
 *   - exercise_order === 0          (it was never performed)
 *   - is_completed === false
 *   - reps === 0
 *   - weight === 0
 *
 * set_number is NOT part of the sentinel — multi-ghost rows can exist.
 */
export interface GhostRowFields {
  reps: number | null | undefined;
  weight: number | null | undefined;
  is_completed: boolean | null | undefined;
  exercise_order: number | null | undefined;
  programmed_order: number | null | undefined;
}

export function isGhostRow(set: GhostRowFields): boolean {
  return (
    set.programmed_order != null &&
    (set.exercise_order ?? 0) === 0 &&
    !set.is_completed &&
    (set.reps ?? 0) === 0 &&
    (set.weight ?? 0) === 0
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=ghostRow`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/ghostRow.ts src/__tests__/ghostRow.test.ts
git commit -m "feat(mcp): extract isGhostRow predicate matching app's composite sentinel"
```

---

## Task 3: Apply `isGhostRow` to `get_workout_detail`

**Files:**
- Modify: `src/tools/read/workouts.ts:115-121`

- [ ] **Step 1: Import the predicate**

In `src/tools/read/workouts.ts`, after the existing imports near line 5, add:

```typescript
import { isGhostRow } from '../ghostRow.js';
```

- [ ] **Step 2: Replace the inline filter**

Replace lines 115-121 (the `isGhost` block):

```typescript
          // Ghost row detection: set_number=1, reps=0, weight=0, is_completed=false
          const isGhost =
            s.set_number === 1 &&
            (s.reps ?? 0) === 0 &&
            (s.weight ?? 0) === 0 &&
            !s.is_completed;
```

with:

```typescript
          const isGhost = isGhostRow({
            reps: s.reps,
            weight: s.weight,
            is_completed: s.is_completed,
            exercise_order: (s as any).exercise_order,
            programmed_order: (s as any).programmed_order,
          });
```

- [ ] **Step 3: Build and run existing tests**

Run: `npm run build && npm test`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/tools/read/workouts.ts
git commit -m "fix(mcp): use canonical composite sentinel for ghost rows in get_workout_detail"
```

---

## Task 4: Filter ghost rows in `get_exercise_history`

**Files:**
- Modify: `src/tools/read/exercises.ts:184-196`

- [ ] **Step 1: Import the predicate**

Near the top of `src/tools/read/exercises.ts` (after existing imports around line 5), add:

```typescript
import { isGhostRow } from '../ghostRow.js';
```

- [ ] **Step 2: Apply filter before pushing sets**

Replace lines 184-195 in `get_exercise_history`:

```typescript
          byWorkout[wid].sets.push({
            set_number: s.set_number,
            reps: s.reps,
            weight: s.weight,
            tag: s.tag,
            rpe: s.rpe,
            is_completed: s.is_completed,
            target_weight: s.target_weight ?? null,
            target_reps: s.target_reps ?? null,
            target_rpe: s.target_rpe ?? null,
            programmed_order: (s as any).programmed_order ?? null,
          });
```

with:

```typescript
          const ghost = isGhostRow({
            reps: s.reps,
            weight: s.weight,
            is_completed: s.is_completed,
            exercise_order: (s as any).exercise_order,
            programmed_order: (s as any).programmed_order,
          });
          if (!ghost) {
            byWorkout[wid].sets.push({
              set_number: s.set_number,
              reps: s.reps,
              weight: s.weight,
              tag: s.tag,
              rpe: s.rpe,
              is_completed: s.is_completed,
              target_weight: s.target_weight ?? null,
              target_reps: s.target_reps ?? null,
              target_rpe: s.target_rpe ?? null,
              programmed_order: (s as any).programmed_order ?? null,
            });
          }
```

- [ ] **Step 3: Drop sessions with zero non-ghost sets**

In `src/tools/read/exercises.ts`, find the sorting block around line 198-200:

```typescript
        const sorted = Object.values(byWorkout)
          .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
          .slice(0, limit);
```

Replace with:

```typescript
        const sorted = Object.values(byWorkout)
          .filter(w => w.sets.length > 0)
          .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
          .slice(0, limit);
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/read/exercises.ts
git commit -m "fix(mcp): filter ghost rows from get_exercise_history and drop empty sessions"
```

---

## Task 5: AsyncLocalStorage-backed request context

**Files:**
- Create: `src/context.ts`
- Test: `src/__tests__/context.test.ts`
- Modify: `src/tools/shared.ts`

- [ ] **Step 1: Write failing concurrent-isolation test**

Create `src/__tests__/context.test.ts`:

```typescript
import { runWithContext, getCurrentContextOrNull, getCurrentContext } from '../context.js';

describe('request context isolation', () => {
  it('returns null outside any request', () => {
    expect(getCurrentContextOrNull()).toBeNull();
  });

  it('throws when getCurrentContext called with no context', () => {
    expect(() => getCurrentContext()).toThrow(/No user context/);
  });

  it('isolates concurrent contexts (no cross-request bleed)', async () => {
    const observed: Array<{ expected: string; actual: string }> = [];

    const make = (userId: string) =>
      runWithContext({ userId, supabaseUrl: 'u', supabaseServiceRoleKey: 'k' }, async () => {
        // Yield so other tasks can interleave
        await new Promise(r => setTimeout(r, 1));
        observed.push({ expected: userId, actual: getCurrentContext().userId });
        await new Promise(r => setTimeout(r, 1));
        observed.push({ expected: userId, actual: getCurrentContext().userId });
      });

    await Promise.all([make('user-A'), make('user-B'), make('user-C')]);

    for (const o of observed) {
      expect(o.actual).toBe(o.expected);
    }
  });

  it('clears context after the run resolves', async () => {
    await runWithContext(
      { userId: 'u', supabaseUrl: 'u', supabaseServiceRoleKey: 'k' },
      async () => {
        expect(getCurrentContext().userId).toBe('u');
      },
    );
    expect(getCurrentContextOrNull()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=context`
Expected: FAIL — `Cannot find module '../context.js'`

- [ ] **Step 3: Implement the context module**

Create `src/context.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context: user identity and Supabase config. */
export interface RequestContext {
  userId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

const store = new AsyncLocalStorage<RequestContext>();

/**
 * Run an async function with the given context. The context is only visible
 * to code that runs (synchronously or asynchronously) inside `fn`.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

/** Return the current request's context, or null if outside a request. */
export function getCurrentContextOrNull(): RequestContext | null {
  return store.getStore() ?? null;
}

/** Return the current request's context. Throws if none. */
export function getCurrentContext(): RequestContext {
  const ctx = store.getStore();
  if (!ctx) {
    throw new Error('No user context available. This must run inside runWithContext.');
  }
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=context`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/__tests__/context.test.ts
git commit -m "feat(mcp): add AsyncLocalStorage-backed per-request context"
```

---

## Task 6: Switch `tools/shared.ts` to use the new context

**Files:**
- Modify: `src/tools/shared.ts`

- [ ] **Step 1: Replace `getCurrentContext` and remove `setContextProvider`**

Replace the top of `src/tools/shared.ts` (lines 1-26) — keep the rest of the file unchanged. The new top reads:

```typescript
import { supabase } from '../supabase.js';
import { getCurrentContext as getRequestContext, getCurrentContextOrNull } from '../context.js';

/** Context exposed to tools — narrower than RequestContext (no secrets). */
export interface ToolContext {
  userId: string;
}

/**
 * Get the current user context.
 * - HTTP transport: provided by worker.ts via runWithContext.
 * - stdio transport: falls back to WORKOUT_USER_ID env var (local dev).
 */
export function getCurrentContext(): ToolContext {
  const ctx = getCurrentContextOrNull();
  if (ctx) return { userId: ctx.userId };

  const userId = process.env.WORKOUT_USER_ID;
  if (!userId) {
    throw new Error('No user context available. Set WORKOUT_USER_ID or use HTTP transport with auth.');
  }
  return { userId };
}
```

- [ ] **Step 2: Remove any remaining references to `setContextProvider`**

Search and verify:

Run: `grep -rn 'setContextProvider' /Users/sachitgoyal/code/lift-ai-mcp/src/`
Expected: only `worker.ts` references remain (cleaned up in Task 8).

- [ ] **Step 3: Build to verify type correctness**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools/shared.ts
git commit -m "refactor(mcp): delegate tool context to AsyncLocalStorage"
```

---

## Task 7: Per-request Supabase client (drop module-level singleton)

**Files:**
- Modify: `src/supabase.ts`

- [ ] **Step 1: Rewrite the file to read config from request context**

Replace the entire `src/supabase.ts` file with:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from './timeout.js';
import { getCurrentContextOrNull } from './context.js';

function getSupabaseConfig(): { url: string; key: string } {
  // Prefer per-request context (HTTP transport).
  const ctx = getCurrentContextOrNull();
  if (ctx) {
    return { url: ctx.supabaseUrl, key: ctx.supabaseServiceRoleKey };
  }

  // Fall back to env (stdio transport / local dev / tests).
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  return { url, key };
}

/**
 * Get a Supabase client. A fresh client is constructed per call when running
 * inside an HTTP request — Cloudflare Workers reuses isolates across concurrent
 * requests, so a module-level singleton can leak one request's config into
 * another's queries.
 *
 * The stdio path caches a single client because there is exactly one user.
 */
let _stdioClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const { url, key } = getSupabaseConfig();

  // HTTP path: fresh client per call. The cost is a small object alloc;
  // the underlying fetch is reused via Node's connection pool / Workers' subrequest pool.
  if (getCurrentContextOrNull()) {
    return createClient(url, key, { global: { fetch: fetchWithTimeout() } });
  }

  // stdio path: cache one client.
  if (!_stdioClient) {
    _stdioClient = createClient(url, key, { global: { fetch: fetchWithTimeout() } });
  }
  return _stdioClient;
}

/**
 * Proxy that defers to getSupabase() on every property access. Preserves the
 * existing `supabase.from(...)` ergonomics throughout the tool files.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
```

- [ ] **Step 2: Build and run all tests**

Run: `npm run build && npm test`
Expected: PASS. (Note: existing tools using `supabase.from(...)` still work because of the Proxy.)

- [ ] **Step 3: Commit**

```bash
git add src/supabase.ts
git commit -m "refactor(mcp): per-request Supabase client to prevent cross-request bleed"
```

---

## Task 8: JWT signature verification

**Files:**
- Modify: `src/auth.ts`
- Create: `src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/auth.test.ts`:

```typescript
import { SignJWT } from 'jose';
import { validateToken, validateAuthHeader } from '../auth.js';

const SECRET = 'test-secret-do-not-use-in-prod-this-is-32+chars-of-test-data';
const WRONG_SECRET = 'different-secret-of-similar-length-for-the-test-key';

async function signToken(payload: object, secret = SECRET): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
}

const baseClaims = {
  sub: 'user-123',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'test@example.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

describe('validateToken (with signature verification)', () => {
  it('accepts a token signed with the correct secret', async () => {
    const token = await signToken(baseClaims);
    const result = await validateToken(token, SECRET);
    expect(result).toEqual({ success: true, userId: 'user-123', email: 'test@example.com' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken(baseClaims, WRONG_SECRET);
    const result = await validateToken(token, SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token with no signature', async () => {
    const [header, payload] = (await signToken(baseClaims)).split('.');
    const unsigned = `${header}.${payload}.`;
    const result = await validateToken(unsigned, SECRET);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed token', async () => {
    const result = await validateToken('not-a-jwt', SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('MALFORMED_TOKEN');
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ ...baseClaims, exp: Math.floor(Date.now() / 1000) - 60 });
    const result = await validateToken(token, SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('EXPIRED_TOKEN');
  });

  it('rejects a token with wrong audience', async () => {
    const token = await signToken({ ...baseClaims, aud: 'other-audience' });
    const result = await validateToken(token, SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token with no sub claim', async () => {
    const { sub: _drop, ...claims } = baseClaims;
    const token = await signToken(claims);
    const result = await validateToken(token, SECRET);
    expect(result.success).toBe(false);
  });
});

describe('validateAuthHeader', () => {
  it('extracts and validates a Bearer token', async () => {
    const token = await signToken(baseClaims);
    const result = await validateAuthHeader(`Bearer ${token}`, SECRET);
    expect(result.success).toBe(true);
  });

  it('rejects missing header', async () => {
    const result = await validateAuthHeader(null, SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('MISSING_TOKEN');
  });

  it('rejects header without Bearer prefix', async () => {
    const token = await signToken(baseClaims);
    const result = await validateAuthHeader(token, SECRET);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('MISSING_TOKEN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=auth`
Expected: FAIL — validateToken is not async / wrong signature.

- [ ] **Step 3: Rewrite `src/auth.ts` to verify signatures**

Replace `src/auth.ts` with:

```typescript
/**
 * JWT authentication middleware for MCP server.
 * Validates Supabase JWT tokens by verifying HS256 signature against the
 * project's JWT secret, then extracts user ID and expiration claims.
 */
import { jwtVerify } from 'jose';

interface AuthResult {
  success: true;
  userId: string;
  email?: string;
}

interface AuthError {
  success: false;
  error: string;
  code: 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'MALFORMED_TOKEN';
}

export type AuthValidationResult = AuthResult | AuthError;

function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Verify a Supabase JWT's HS256 signature and validate its claims.
 *
 * `secret` is the Supabase project's JWT secret (NOT the service role key).
 * Find it in: Supabase Dashboard → Project Settings → API → JWT Settings.
 */
export async function validateToken(token: string, secret: string): Promise<AuthValidationResult> {
  if (!token || token.split('.').length !== 3) {
    return { success: false, error: 'Invalid JWT format', code: 'MALFORMED_TOKEN' };
  }

  let payload: Record<string, unknown>;
  try {
    const key = new TextEncoder().encode(secret);
    const result = await jwtVerify(token, key, { audience: 'authenticated', algorithms: ['HS256'] });
    payload = result.payload as Record<string, unknown>;
  } catch (e: unknown) {
    const code = (e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : '') || '';
    if (code === 'ERR_JWT_EXPIRED') {
      return { success: false, error: 'Token has expired', code: 'EXPIRED_TOKEN' };
    }
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' || code === 'ERR_JWT_INVALID') {
      return { success: false, error: 'Invalid token claims', code: 'INVALID_TOKEN' };
    }
    if (code === 'ERR_JWS_INVALID' || code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return { success: false, error: 'Invalid token signature', code: 'INVALID_TOKEN' };
    }
    return { success: false, error: 'Invalid token', code: 'INVALID_TOKEN' };
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { success: false, error: 'JWT missing sub claim (user ID)', code: 'INVALID_TOKEN' };
  }

  return {
    success: true,
    userId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/** Validate Authorization header. */
export async function validateAuthHeader(
  authHeader: string | null | undefined,
  secret: string,
): Promise<AuthValidationResult> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return {
      success: false,
      error: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      code: 'MISSING_TOKEN',
    };
  }
  return validateToken(token, secret);
}

export function createAuthErrorResponse(result: AuthError): Response {
  const status = result.code === 'MISSING_TOKEN' ? 401 : 403;
  return new Response(JSON.stringify({ error: result.error, code: result.code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=auth`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/__tests__/auth.test.ts
git commit -m "feat(mcp): verify JWT HS256 signature against Supabase JWT secret"
```

---

## Task 9: Wire JWT secret + ALS through `worker.ts`

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Update Env interface and replace fetch handler**

Replace `src/worker.ts` with:

```typescript
/**
 * Cloudflare Worker entry point for the lift-ai MCP server.
 * Handles HTTP requests with JWT authentication and routes to MCP server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateAuthHeader, createAuthErrorResponse } from './auth.js';
import { runWithContext } from './context.js';
import { registerReadTools } from './tools/read/index.js';
import { registerWriteTools } from './tools/write/index.js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
} as const;

const CORS_PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
} as const;

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'lift-ai', version: '1.0.0' });
  registerReadTools(server);
  registerWriteTools(server);
  return server;
}

function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }
  return null;
}

function addCorsHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const corsResponse = handleCors(request);
    if (corsResponse) return corsResponse;

    if (url.pathname !== '/mcp') {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!env.SUPABASE_JWT_SECRET) {
      console.error('SUPABASE_JWT_SECRET is not set');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authHeader = request.headers.get('Authorization');
    const authResult = await validateAuthHeader(authHeader, env.SUPABASE_JWT_SECRET);

    if (!authResult.success) {
      return addCorsHeaders(createAuthErrorResponse(authResult));
    }

    return runWithContext(
      {
        userId: authResult.userId,
        supabaseUrl: env.SUPABASE_URL,
        supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      },
      async () => {
        try {
          const server = createMcpServer();
          const transport = new WebStandardStreamableHTTPServerTransport({
            enableJsonResponse: true,
          });
          await server.connect(transport);

          const response = await transport.handleRequest(request, {
            authInfo: {
              token: authHeader!.replace(/^Bearer\s+/i, ''),
              clientId: authResult.userId,
              scopes: ['read', 'write'],
            },
          });
          return addCorsHeaders(response);
        } catch (error) {
          console.error('MCP request error:', error);
          return addCorsHeaders(
            new Response(
              JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Unknown error',
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
      },
    );
  },
};
```

- [ ] **Step 2: Build to verify type correctness**

Run: `npm run build`
Expected: exits 0. Any errors usually point at stale imports of `setContextProvider` / `ToolContext` from `worker.ts` — those imports should be gone.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS, including existing tests.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "fix(mcp): per-request context via ALS; require JWT secret env"
```

---

## Task 10: Document the JWT secret env var

**Files:**
- Modify: `.dev.vars` (user action — do not commit)
- Modify: `README.md` if it exists in MCP repo

- [ ] **Step 1: Print instructions for the user**

Echo the following (do NOT run `wrangler secret put` autonomously — user must approve a secret):

```
ACTION REQUIRED — set the JWT secret in both environments:

Local dev (.dev.vars — add this line, do not commit):
  SUPABASE_JWT_SECRET=<value from Supabase Dashboard → Project Settings → API → JWT Settings>

Cloudflare prod:
  wrangler secret put SUPABASE_JWT_SECRET --env production
  # paste the prod project's JWT secret when prompted

Cloudflare dev:
  wrangler secret put SUPABASE_JWT_SECRET --env dev
  # paste the dev project's JWT secret when prompted

Get the secret from:
  Prod:  https://supabase.com/dashboard/project/lgnkxjiqzsqiwrqrsxww/settings/api → "JWT Settings" → "JWT Secret"
  Dev:   https://supabase.com/dashboard/project/gcpnqpqqwcwvyzoivolp/settings/api → "JWT Settings" → "JWT Secret"
```

- [ ] **Step 2: Update MCP README if it has an env-vars section**

Check: `cat /Users/sachitgoyal/code/lift-ai-mcp/README.md | grep -i 'SUPABASE_'`
If it lists env vars, add `SUPABASE_JWT_SECRET` with the same explanation as above.

If README updated, commit:

```bash
git add README.md
git commit -m "docs(mcp): add SUPABASE_JWT_SECRET to required env vars"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full test suite**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && npm test`
Expected: all green.

- [ ] **Step 2: TypeScript build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Grep for residual leaks**

Run:
```bash
grep -rn 'globalThis.*SUPABASE' /Users/sachitgoyal/code/lift-ai-mcp/src/
grep -rn 'currentRequestContext' /Users/sachitgoyal/code/lift-ai-mcp/src/
grep -rn 'setContextProvider' /Users/sachitgoyal/code/lift-ai-mcp/src/
grep -rn '_supabase' /Users/sachitgoyal/code/lift-ai-mcp/src/
```
Expected: zero matches. (`_stdioClient` in `supabase.ts` is fine.)

- [ ] **Step 4: Test the local stdio path manually (smoke test)**

Run:
```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
WORKOUT_USER_ID="<your supabase user id>" npm start
# In another terminal, send a minimal MCP request via the Claude Desktop config
# OR confirm the process starts without errors.
```
Expected: process starts cleanly, no "No user context" errors.

- [ ] **Step 5: Confirm wrangler validates the worker**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && npx wrangler deploy --dry-run --env dev`
Expected: bundles cleanly; reports the env vars and secrets it expects (should now include `SUPABASE_JWT_SECRET`).

- [ ] **Step 6: Code review (mandatory gate)**

From the lift-ai repo / worktree, run:
```bash
/code-review deep --path /Users/sachitgoyal/code/lift-ai-mcp/src --spec docs/superpowers/plans/2026-05-17-batch-1-mcp-security.md
```
Expected: green or only minor findings. Fix actionable findings, then re-review.

---

## Risks and rollback

- **JWT secret mismatch in prod → 100% auth failure.** Mitigation: deploy with dry-run first; if a request fails with INVALID_TOKEN immediately after deploy, secret is wrong. `wrangler rollback` reverts the worker.
- **AsyncLocalStorage requires `nodejs_compat` flag.** Already enabled in `wrangler.toml:6`. Verified.
- **Per-request Supabase client adds object alloc + fetch pool churn.** Acceptable for security; revisit only if benchmarks show >50ms p99 added latency.
- **Stdio mode (Claude Desktop local) bypasses JWT verification by design.** WORKOUT_USER_ID env var remains the trust anchor for local use. Document this in MCP README.

---

## Self-review notes (filled in during writing-plans)

- Spec coverage: 3 issues → covered by Tasks 2-4 (ghost row), Tasks 5-7 + 9 (context isolation), Tasks 1 + 8 + 9 (JWT). ✓
- Placeholder scan: none. ✓
- Type consistency: `RequestContext` is defined once in `context.ts` and consumed by `worker.ts`, `supabase.ts`. `ToolContext` is narrower (no secrets) and lives only in `tools/shared.ts`. ✓
- `setContextProvider` removed from public API; `getCurrentContext` now reads from ALS with stdio env fallback. No tool file changes needed. ✓
