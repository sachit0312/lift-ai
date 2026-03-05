import { calculateEstimated1RM, calculateE1RM, getPRGatingMargin } from '../oneRepMax';

// ─── Backwards Compat: calculateEstimated1RM returns a number ───

describe('calculateEstimated1RM (backwards compat)', () => {
  it('returns a number', () => {
    expect(typeof calculateEstimated1RM(100, 5)).toBe('number');
  });

  it('returns 0 when weight is 0', () => {
    expect(calculateEstimated1RM(0, 5)).toBe(0);
  });

  it('returns weight when reps is 0', () => {
    expect(calculateEstimated1RM(200, 0)).toBe(200);
  });

  it('returns 0 when both weight and reps are 0', () => {
    expect(calculateEstimated1RM(0, 0)).toBe(0);
  });

  it('produces positive estimates for valid inputs', () => {
    expect(calculateEstimated1RM(100, 5)).toBeGreaterThan(100);
  });

  it('produces higher estimates for more reps at same weight', () => {
    expect(calculateEstimated1RM(100, 10)).toBeGreaterThan(calculateEstimated1RM(100, 5));
  });

  it('produces higher estimates for higher weight at same reps', () => {
    expect(calculateEstimated1RM(200, 5)).toBeGreaterThan(calculateEstimated1RM(100, 5));
  });
});

// ─── Full API: calculateE1RM returns E1RMResult ───

describe('calculateE1RM', () => {
  // ─── Path A: RPE provided → table lookup ───

  describe('with RPE (table lookup)', () => {
    it('uses rpe_table method when RPE is provided', () => {
      const result = calculateE1RM(200, 5, 8);
      expect(result.method).toBe('rpe_table');
    });

    it('estimates 1RM from 5 reps at RPE 8 using table percentage (0.811)', () => {
      // 200 / 0.811 = 246.61
      const result = calculateE1RM(200, 5, 8);
      expect(result.value).toBeCloseTo(246.61, 0);
    });

    it('returns exact weight for 1 rep at RPE 10', () => {
      // 1 rep @ RPE 10 = 100% 1RM → weight / 1.0 = weight
      const result = calculateE1RM(225, 1, 10);
      expect(result.value).toBe(225);
    });

    it('estimates from 1 rep at RPE 9 (95.5%)', () => {
      // 225 / 0.955 = 235.6
      const result = calculateE1RM(225, 1, 9);
      expect(result.value).toBeCloseTo(235.6, 0);
    });

    it('estimates from 3 reps at RPE 9 (89.2%)', () => {
      // 200 / 0.892 = 224.22
      const result = calculateE1RM(200, 3, 9);
      expect(result.value).toBeCloseTo(224.22, 0);
    });

    it('handles failure sets (RPE 10)', () => {
      const result = calculateE1RM(185, 5, 10);
      // 5 reps @ RPE 10 = 86.3% → 185 / 0.863 = 214.37
      expect(result.value).toBeCloseTo(214.37, 0);
    });

    it('clamps RPE below 6', () => {
      // RPE 5 should be treated as RPE 6
      const result = calculateE1RM(100, 5, 5);
      const expected = calculateE1RM(100, 5, 6);
      expect(result.value).toBeCloseTo(expected.value, 2);
    });
  });

  // ─── Path B: No RPE → ensemble ───

  describe('without RPE (ensemble)', () => {
    it('uses ensemble method when RPE is null', () => {
      expect(calculateE1RM(100, 5, null).method).toBe('ensemble');
    });

    it('uses ensemble method when RPE is undefined', () => {
      expect(calculateE1RM(100, 5).method).toBe('ensemble');
    });

    it('produces reasonable estimate for 5 reps (no RPE)', () => {
      const result = calculateE1RM(200, 5);
      // Should be in the ballpark of 220-240 for 200x5
      expect(result.value).toBeGreaterThan(215);
      expect(result.value).toBeLessThan(245);
    });

    it('produces reasonable estimate for 10 reps (no RPE)', () => {
      const result = calculateE1RM(150, 10);
      // Should be in the ballpark of 190-210 for 150x10
      expect(result.value).toBeGreaterThan(185);
      expect(result.value).toBeLessThan(215);
    });

    it('blends correctly for low reps (Brzycki-dominant)', () => {
      // At 3 reps, Brzycki weight is 0.50
      const result = calculateE1RM(200, 3);
      expect(result.method).toBe('ensemble');
      expect(result.value).toBeGreaterThan(200);
    });

    it('blends correctly for high reps (Wathen-dominant)', () => {
      const result = calculateE1RM(100, 15);
      expect(result.method).toBe('ensemble');
      expect(result.value).toBeGreaterThan(100);
    });
  });

  // ─── Confidence scoring ───

  describe('confidence tiers', () => {
    it('returns HIGH for 1-5 reps with RPE >= 7', () => {
      expect(calculateE1RM(200, 3, 8).confidence).toBe('high');
      expect(calculateE1RM(200, 5, 7).confidence).toBe('high');
    });

    it('returns MEDIUM for 6-10 reps with RPE', () => {
      expect(calculateE1RM(200, 8, 8).confidence).toBe('medium');
      expect(calculateE1RM(200, 10, 9).confidence).toBe('medium');
    });

    it('returns HIGH with 0% margin for 1 rep at near-max RPE or no RPE', () => {
      expect(calculateE1RM(200, 1).confidence).toBe('high');
      expect(calculateE1RM(200, 1).marginPercent).toBe(0);
      expect(calculateE1RM(200, 1, null).confidence).toBe('high');
      expect(calculateE1RM(200, 1, 9).confidence).toBe('high');
      expect(calculateE1RM(200, 1, 9).marginPercent).toBe(0);
      expect(calculateE1RM(200, 1, 10).confidence).toBe('high');
    });

    it('returns HIGH with 3% margin for 1 rep at moderate RPE (not near-max)', () => {
      // 1 rep at RPE 7 or 8 = still high confidence via the 1-5 reps + RPE >= 7 branch
      expect(calculateE1RM(200, 1, 8).confidence).toBe('high');
      expect(calculateE1RM(200, 1, 8).marginPercent).toBe(3);
      expect(calculateE1RM(200, 1, 7).confidence).toBe('high');
      expect(calculateE1RM(200, 1, 7).marginPercent).toBe(3);
    });

    it('returns MEDIUM for 1 rep at low RPE (< 7)', () => {
      // 1 rep at RPE 6 = not near-max, not in RPE >= 7 branch → medium
      expect(calculateE1RM(200, 1, 6).confidence).toBe('medium');
      expect(calculateE1RM(200, 1, 6).marginPercent).toBe(6);
    });

    it('returns MEDIUM for 2-10 reps without RPE', () => {
      expect(calculateE1RM(200, 5).confidence).toBe('medium');
      expect(calculateE1RM(200, 3, null).confidence).toBe('medium');
    });

    it('returns LOW for 11+ reps', () => {
      expect(calculateE1RM(100, 12).confidence).toBe('low');
      expect(calculateE1RM(100, 15, 8).confidence).toBe('low');
      expect(calculateE1RM(100, 20).confidence).toBe('low');
    });

    it('includes correct margin percentages', () => {
      expect(calculateE1RM(200, 1, 10).marginPercent).toBe(0);  // near-max single
      expect(calculateE1RM(200, 1, 8).marginPercent).toBe(3);   // single with moderate RPE
      expect(calculateE1RM(200, 3, 8).marginPercent).toBe(3);   // low reps + RPE >= 7
      expect(calculateE1RM(200, 8, 8).marginPercent).toBe(6);   // medium reps
      expect(calculateE1RM(100, 15).marginPercent).toBe(12);    // high reps
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('returns 0 for negative weight', () => {
      expect(calculateE1RM(-100, 5).value).toBe(0);
    });

    it('returns weight for 0 reps', () => {
      expect(calculateE1RM(225, 0).value).toBe(225);
    });

    it('handles decimal weights', () => {
      const result = calculateE1RM(67.5, 8, 8);
      expect(result.value).toBeGreaterThan(67.5);
      expect(result.method).toBe('rpe_table');
    });
  });

  // ─── RPE table vs old Epley comparison ───

  describe('RPE table vs old Epley comparison', () => {
    it('RPE 10 at low reps diverges from old formula', () => {
      // Old Epley: 200 * (1 + 5/30) = 233.33
      // New table: 200 / 0.863 = 231.75
      // They should be similar but not identical
      const newResult = calculateE1RM(200, 5, 10).value;
      const oldResult = 200 * (1 + 5 / 30);
      expect(Math.abs(newResult - oldResult)).toBeLessThan(10);
    });

    it('RPE 8 at 5 reps diverges more from old approach', () => {
      // Old Epley with RIR addition: reps + (10-8) = 7, 200 * (1 + 7/30) = 246.67
      // New table: 200 / 0.811 = 246.61
      // Close agreement at moderate RPE
      const newResult = calculateE1RM(200, 5, 8).value;
      const oldResult = 200 * (1 + 7 / 30);
      expect(Math.abs(newResult - oldResult)).toBeLessThan(5);
    });
  });
});

// ─── PR Gating Margins ───

describe('getPRGatingMargin', () => {
  it('returns 0 for high confidence (any improvement counts)', () => {
    expect(getPRGatingMargin('high')).toBe(0);
  });

  it('returns 0.01 for medium confidence (1% buffer)', () => {
    expect(getPRGatingMargin('medium')).toBe(0.01);
  });

  it('returns 0.03 for low confidence (3% buffer)', () => {
    expect(getPRGatingMargin('low')).toBe(0.03);
  });
});
