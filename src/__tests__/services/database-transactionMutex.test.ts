/**
 * expo-sqlite's withTransactionAsync is BEGIN / task / COMMIT with a catch → ROLLBACK, issued
 * on one shared connection with no mutual exclusion. Overlapping calls corrupt each other:
 * the second BEGIN fails, its ROLLBACK tears down the FIRST transaction's work, and the
 * survivor reports "cannot rollback - no transaction is active" (Sentry REACT-NATIVE-G).
 *
 * runInTransaction serializes them. These tests pin that, using a fake connection that
 * reproduces real SQLite's rejection of a nested BEGIN.
 */
import * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite');

// database.ts imports supabase at module load, which throws without env vars present.
jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) } },
}));

/** Minimal connection modelling SQLite's single-transaction-per-connection rule. */
function makeFakeDb() {
  const state = { depth: 0, committed: 0, rolledBack: 0, maxDepth: 0 };
  const db = {
    state,
    async withTransactionAsync(task: () => Promise<void>) {
      if (state.depth > 0) {
        // Real SQLite: "cannot start a transaction within a transaction"
        state.depth = 0;
        state.rolledBack++;
        throw new Error('Calling the \'execAsync\' function has failed');
      }
      state.depth++;
      state.maxDepth = Math.max(state.maxDepth, state.depth);
      try {
        await task();
        state.depth--;
        state.committed++;
      } catch (e) {
        state.depth--;
        state.rolledBack++;
        throw e;
      }
    },
  };
  return db as unknown as SQLite.SQLiteDatabase & { state: typeof state };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runInTransaction', () => {
  let runInTransaction: typeof import('../../services/database').runInTransaction;
  let getDb: typeof import('../../services/database').getDb;
  let resetDatabase: typeof import('../../services/database').resetDatabase;

  beforeEach(() => {
    jest.resetModules();
    const database = require('../../services/database') as typeof import('../../services/database');
    runInTransaction = database.runInTransaction;
    getDb = database.getDb;
    resetDatabase = database.resetDatabase;
  });

  it('serializes overlapping transactions instead of nesting them', async () => {
    const db = makeFakeDb();
    const order: string[] = [];

    // Both start before either finishes — the exact shape of a fire-and-forget sync racing
    // a workout write.
    const a = runInTransaction(db, async () => {
      order.push('a:start');
      await tick();
      await tick();
      order.push('a:end');
    });
    const b = runInTransaction(db, async () => {
      order.push('b:start');
      await tick();
      order.push('b:end');
    });

    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(db.state.maxDepth).toBe(1);
    expect(db.state.committed).toBe(2);
    expect(db.state.rolledBack).toBe(0);
  });

  it('queues a transaction that arrives while another callback is active', async () => {
    const db = makeFakeDb();
    const order: string[] = [];
    let releaseA!: () => void;
    let signalAStarted!: () => void;
    const aCanFinish = new Promise<void>((resolve) => { releaseA = resolve; });
    const aStarted = new Promise<void>((resolve) => { signalAStarted = resolve; });

    // This catches a process-global "in transaction" flag: B is independent work that arrives
    // after A has started, so it must wait rather than be mistaken for a nested call.
    const a = runInTransaction(db, async () => {
      order.push('a:start');
      signalAStarted();
      await aCanFinish;
      order.push('a:end');
    });
    await aStarted;
    const b = runInTransaction(db, async () => {
      order.push('b:start');
      order.push('b:end');
    });
    releaseA();

    await Promise.all([a, b]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(db.state.maxDepth).toBe(1);
  });

  it('returns the task result, which withTransactionAsync itself discards', async () => {
    const db = makeFakeDb();
    await expect(runInTransaction(db, async () => 42)).resolves.toBe(42);
  });

  it('propagates a failure to its own caller only', async () => {
    const db = makeFakeDb();

    const failing = runInTransaction(db, async () => { throw new Error('boom'); });
    await expect(failing).rejects.toThrow('boom');

    // A poisoned chain would strand every later write — the failure must not propagate.
    await expect(runInTransaction(db, async () => 'ok')).resolves.toBe('ok');
    expect(db.state.committed).toBe(1);
    expect(db.state.rolledBack).toBe(1);
  });

  it('keeps serializing after a failure mid-queue', async () => {
    const db = makeFakeDb();
    const order: string[] = [];

    const a = runInTransaction(db, async () => { order.push('a'); await tick(); throw new Error('a failed'); });
    const b = runInTransaction(db, async () => { order.push('b'); await tick(); });
    const c = runInTransaction(db, async () => { order.push('c'); });

    await Promise.allSettled([a, b, c]);

    expect(order).toEqual(['a', 'b', 'c']);
    expect(db.state.maxDepth).toBe(1);
    expect(db.state.committed).toBe(2);
  });

  it('rejects a nested call rather than deadlocking on itself', async () => {
    const db = makeFakeDb();

    // Serializing converts a nested transaction from a loud SQLite error into a silent hang:
    // the inner call queues behind the outer one that is awaiting it. Must fail fast.
    const outer = runInTransaction(db, async (context) => {
      await runInTransaction(db, async () => 'inner', context);
    });

    await expect(outer).rejects.toThrow(/Nested runInTransaction/);
    expect(db.state.depth).toBe(0);
  });

  it('drains admitted transactions before reset and rejects stale connections after it starts', async () => {
    const events: string[] = [];
    const makeResetDb = (name: string) => ({
      async execAsync() {},
      async getFirstAsync(query: string) {
        if (query === 'PRAGMA quick_check(1)') return { quick_check: 'ok' };
        if (query.startsWith('SELECT COUNT(*)')) return { count: 0 };
        return null;
      },
      async runAsync() { return { changes: 0 }; },
      async getAllAsync() { return []; },
      async closeAsync() { events.push(`${name}:close`); },
      async withTransactionAsync(task: () => Promise<void>) {
        events.push(`${name}:transaction:start`);
        await task();
        events.push(`${name}:transaction:end`);
      },
    }) as unknown as SQLite.SQLiteDatabase;
    const oldDb = makeResetDb('old');
    const newDb = makeResetDb('new');
    const sqlite = require('expo-sqlite') as typeof SQLite;
    jest.spyOn(sqlite, 'openDatabaseAsync')
      .mockResolvedValueOnce(oldDb)
      .mockResolvedValueOnce(newDb);
    jest.spyOn(sqlite, 'deleteDatabaseAsync').mockImplementation(async () => {
      events.push('delete');
    });

    expect(await getDb()).toBe(oldDb);

    let releaseA!: () => void;
    let signalAStarted!: () => void;
    const aCanFinish = new Promise<void>((resolve) => { releaseA = resolve; });
    const aStarted = new Promise<void>((resolve) => { signalAStarted = resolve; });
    const a = runInTransaction(oldDb, async () => {
      events.push('a:start');
      signalAStarted();
      await aCanFinish;
      events.push('a:end');
    });
    await aStarted;

    // B was admitted before the reset, so the barrier must drain it before close/delete.
    const b = runInTransaction(oldDb, async () => { events.push('b'); });
    const reset = resetDatabase();

    // C captured the same old handle but arrived after resetDatabase published its barrier.
    // It must not run after reset on either the closed old file or its replacement.
    await expect(runInTransaction(oldDb, async () => { events.push('stale'); }))
      .rejects.toThrow(/unavailable during or after a reset/);
    expect(events).not.toContain('stale');
    expect(events).not.toContain('old:close');
    expect(events).not.toContain('delete');

    releaseA();
    await Promise.all([a, b, reset]);

    expect(events).toEqual([
      'old:transaction:start', 'a:start', 'a:end', 'old:transaction:end',
      'old:transaction:start', 'b', 'old:transaction:end',
      'old:close', 'delete',
    ]);

    // Retaining the old object after a successful reset is also rejected; a newly acquired
    // connection is still usable.
    await expect(runInTransaction(oldDb, async () => { events.push('stale-after-reset'); }))
      .rejects.toThrow(/unavailable during or after a reset/);
    await runInTransaction(newDb, async () => { events.push('new'); });
    expect(events).not.toContain('stale-after-reset');
    expect(events).toContain('new');
  });

  it('demonstrates the corruption it prevents when transactions are not serialized', async () => {
    const db = makeFakeDb();

    // Same two overlapping writes issued directly against the connection.
    const a = db.withTransactionAsync(async () => { await tick(); await tick(); });
    const b = db.withTransactionAsync(async () => { await tick(); });

    const results = await Promise.allSettled([a, b]);

    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    expect(db.state.rolledBack).toBeGreaterThan(0);
  });
});
