import { lookupPercentage } from '../rpeTable';

describe('lookupPercentage', () => {
  // ─── Exact table lookups (published Tuchscherer values) ───

  it('returns 1.0 for 1 rep at RPE 10 (actual 1RM)', () => {
    expect(lookupPercentage(1, 10)).toBe(1.0);
  });

  it('returns correct value for 1 rep at RPE 9', () => {
    expect(lookupPercentage(1, 9)).toBe(0.955);
  });

  it('returns correct value for 1 rep at RPE 8', () => {
    expect(lookupPercentage(1, 8)).toBe(0.922);
  });

  it('returns correct value for 5 reps at RPE 10', () => {
    expect(lookupPercentage(5, 10)).toBe(0.863);
  });

  it('returns correct value for 5 reps at RPE 8', () => {
    expect(lookupPercentage(5, 8)).toBe(0.811);
  });

  it('returns correct value for 3 reps at RPE 9', () => {
    expect(lookupPercentage(3, 9)).toBe(0.892);
  });

  it('returns correct value for 10 reps at RPE 7', () => {
    expect(lookupPercentage(10, 7)).toBe(0.653);
  });

  it('returns correct value for 8 reps at RPE 10', () => {
    expect(lookupPercentage(8, 10)).toBe(0.786);
  });

  // ─── Half-RPE lookups (interpolation on RPE axis) ───

  it('interpolates for half-RPE values (1 rep at RPE 9.5)', () => {
    expect(lookupPercentage(1, 9.5)).toBe(0.978);
  });

  it('interpolates for half-RPE values (5 reps at RPE 8.5)', () => {
    expect(lookupPercentage(5, 8.5)).toBe(0.824);
  });

  // ─── Bilinear interpolation (non-integer reps + non-standard RPE) ───

  it('interpolates between reps 4 and 5 at RPE 9', () => {
    // 4 reps @ RPE 9 = 0.863, 5 reps @ RPE 9 = 0.837
    // 4.5 reps @ RPE 9 should be midpoint = 0.850
    const result = lookupPercentage(4.5, 9);
    expect(result).toBeCloseTo(0.850, 3);
  });

  it('interpolates between reps and RPE simultaneously', () => {
    // RPE 8.5 is an exact column (colFrac = 0), so only row interpolation applies:
    // 2 reps @ RPE 8.5 = 0.907, 3 reps @ RPE 8.5 = 0.878
    // 2.5 reps @ RPE 8.5 = lerp(0.907, 0.878, 0.5) = 0.8925
    const result = lookupPercentage(2.5, 8.5);
    expect(result).toBeCloseTo(0.8925, 3);
  });

  // ─── Edge cases / clamping ───

  it('clamps reps below 1 to 1', () => {
    expect(lookupPercentage(0, 10)).toBe(lookupPercentage(1, 10));
  });

  it('clamps reps above 12 to 12', () => {
    expect(lookupPercentage(20, 10)).toBe(lookupPercentage(12, 10));
  });

  it('clamps RPE below 6 to 6', () => {
    expect(lookupPercentage(5, 4)).toBe(lookupPercentage(5, 6));
  });

  it('clamps RPE above 10 to 10', () => {
    expect(lookupPercentage(5, 11)).toBe(lookupPercentage(5, 10));
  });

  // ─── Monotonicity checks ───

  it('higher RPE = higher percentage at same reps', () => {
    for (let reps = 1; reps <= 12; reps++) {
      const low = lookupPercentage(reps, 7);
      const mid = lookupPercentage(reps, 8.5);
      const high = lookupPercentage(reps, 10);
      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
    }
  });

  it('more reps = lower percentage at same RPE', () => {
    for (const rpe of [6, 7, 8, 9, 10]) {
      const low = lookupPercentage(1, rpe);
      const mid = lookupPercentage(5, rpe);
      const high = lookupPercentage(10, rpe);
      expect(low).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(high);
    }
  });
});
