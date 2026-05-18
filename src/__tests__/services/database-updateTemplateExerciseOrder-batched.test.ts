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
});
