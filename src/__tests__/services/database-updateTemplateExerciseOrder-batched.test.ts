jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { updateTemplateExerciseOrder } = require('../../services/database');

describe('Batch 6 Task 6: updateTemplateExerciseOrder batched UPDATE', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('issues exactly ONE UPDATE for N ordered IDs', async () => {
    await updateTemplateExerciseOrder('t1', ['a', 'b', 'c']);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0]).toMatch(/CASE\s+id\s+WHEN/i);
  });

  it('returns early on empty list (no UPDATE issued)', async () => {
    await updateTemplateExerciseOrder('t1', []);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('scopes the WHERE clause to the template (no cross-template writes)', async () => {
    await updateTemplateExerciseOrder('t1', ['a', 'b']);
    const call = __mockDb.runAsync.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(c[0] as string),
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatch(/AND template_id = \?/);
    // Last bind is the templateId
    const binds = call!.slice(1);
    expect(binds[binds.length - 1]).toBe('t1');
  });

  it('binds (id, sortOrder) pairs and IN placeholders + templateId tail', async () => {
    await updateTemplateExerciseOrder('t1', ['a', 'b']);
    const call = __mockDb.runAsync.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(c[0] as string),
    );
    expect(call).toBeDefined();
    // Expected bind layout: [whenId, thenIdx, whenId, thenIdx, inId, inId, templateId]
    expect(call!.slice(1)).toEqual(['a', 0, 'b', 1, 'a', 'b', 't1']);
  });

  it('chunks input at MAX_PER_CHUNK = 300 (301 entries → 2 calls) with cross-chunk index continuity', async () => {
    const orderedIds = Array.from({ length: 301 }, (_, i) => `e${i}`);
    await updateTemplateExerciseOrder('t1', orderedIds);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(2);

    // The second chunk's binds should start at sort_order = 300 (cross-chunk continuity)
    const secondCall = updateCalls[1];
    // Binds: [id0, 300, id1, 301, ...] — id of first entry in chunk 2 followed by 300
    expect(secondCall[1]).toBe('e300');
    expect(secondCall[2]).toBe(300);
  });
});
