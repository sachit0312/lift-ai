/**
 * Direct unit tests for the 1RM engine.
 * Covers:
 *  - calculateE1RM: weight<=0, reps=0, reps=1 high-confidence path, RPE table path, ensemble fallback
 *  - calculateEstimated1RM: the legacy number-returning wrapper
 *  - getPRGatingMargin: per-tier margins
 *  - boundary conditions: brzycki >=36 reps guard, RPE table boundaries (1-12 reps, 6-10 RPE)
 */
import {
  calculateE1RM,
  calculateEstimated1RM,
  getPRGatingMargin,
} from '../../utils/oneRepMax';
import { lookupPercentage } from '../../data/rpeTable';

describe('calculateE1RM', () => {
  describe('edge cases', () => {
    it('returns zero with low confidence when weight <= 0', () => {
      const r = calculateE1RM(0, 5, 8);
      expect(r.value).toBe(0);
      expect(r.confidence).toBe('low');
      expect(r.method).toBe('ensemble');
    });

    it('returns just the weight when reps <= 0 (unfinished set)', () => {
      const r = calculateE1RM(225, 0, 8);
      expect(r.value).toBe(225);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(0);
    });

    it('handles negative reps as 0', () => {
      const r = calculateE1RM(100, -3);
      expect(r.value).toBe(100);
    });
  });

  describe('RPE table path (Path A)', () => {
    it('uses Tuchscherer lookup when RPE is provided', () => {
      // Reps=5, RPE=8 -> table value 0.811 -> 1RM = weight / 0.811
      const r = calculateE1RM(200, 5, 8);
      expect(r.method).toBe('rpe_table');
      expect(r.value).toBeCloseTo(200 / 0.811, 1);
    });

    it('reps=1 RPE>=9 is HIGH confidence with margin 0 (near-max single)', () => {
      const r = calculateE1RM(200, 1, 10);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(0);
    });

    it('reps 1-5 with RPE>=7 is HIGH confidence with margin 3', () => {
      const r = calculateE1RM(200, 5, 7);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(3);
    });

    it('reps 6-10 is MEDIUM confidence with margin 6', () => {
      const r = calculateE1RM(150, 8, 8);
      expect(r.confidence).toBe('medium');
      expect(r.marginPercent).toBe(6);
    });

    it('reps 11+ is LOW confidence with margin 12', () => {
      const r = calculateE1RM(100, 12, 8);
      expect(r.confidence).toBe('low');
      expect(r.marginPercent).toBe(12);
    });
  });

  describe('ensemble path (Path B, no RPE)', () => {
    it('uses ensemble formulas when RPE is null/undefined', () => {
      const r = calculateE1RM(200, 5);
      expect(r.method).toBe('ensemble');
      // Ensemble for 200×5 with no RPE: brzycki(200,5)=225, epley(200,5)≈233.3, wathen(200,5)≈232.7.
      // Weighted (0.50/0.20/0.30 for reps≤5): ≈ 225*0.50 + 233.3*0.20 + 232.7*0.30 ≈ 228.97
      expect(r.value).toBeGreaterThan(220);
      expect(r.value).toBeLessThan(240);
    });

    it('reps=1 without RPE is HIGH confidence (near-max single)', () => {
      const r = calculateE1RM(200, 1);
      expect(r.confidence).toBe('high');
    });

    it('reps 2-5 without RPE drops to MEDIUM (no RPE-7+ guarantee)', () => {
      const r = calculateE1RM(200, 5);
      expect(r.confidence).toBe('medium');
    });
  });

  describe('brzycki guard at reps >= 36', () => {
    it('returns weight (formula undefined) for ensemble at 36 reps', () => {
      const r = calculateE1RM(100, 36);
      // brzycki returns weight at 36+; ensemble weighted average still produces a finite number > 0
      expect(r.value).toBeGreaterThan(0);
      expect(Number.isFinite(r.value)).toBe(true);
    });

    it('extreme rep counts (>=50) still produce finite output', () => {
      const r = calculateE1RM(100, 100);
      expect(Number.isFinite(r.value)).toBe(true);
    });
  });
});

describe('calculateEstimated1RM (legacy number-returning wrapper)', () => {
  it('returns the .value of calculateE1RM', () => {
    const full = calculateE1RM(225, 5, 8);
    const num = calculateEstimated1RM(225, 5, 8);
    expect(num).toBe(full.value);
  });

  it('returns 0 for invalid weight', () => {
    expect(calculateEstimated1RM(0, 5, 8)).toBe(0);
  });
});

describe('getPRGatingMargin', () => {
  it('returns 0 for high (any improvement counts)', () => {
    expect(getPRGatingMargin('high')).toBe(0);
  });

  it('returns 0.01 (1%) for medium', () => {
    expect(getPRGatingMargin('medium')).toBe(0.01);
  });

  it('returns 0.03 (3%) for low', () => {
    expect(getPRGatingMargin('low')).toBe(0.03);
  });
});

describe('rpeTable lookupPercentage boundaries', () => {
  it('returns exact table value at exact (reps, RPE) cells', () => {
    expect(lookupPercentage(1, 10)).toBeCloseTo(1.0, 3);
    expect(lookupPercentage(5, 8)).toBeCloseTo(0.811, 3);
    expect(lookupPercentage(10, 7)).toBeCloseTo(0.653, 3);
  });

  it('interpolates between RPE columns (rpe=7.25 between 7.0 and 7.5)', () => {
    const at7 = lookupPercentage(5, 7.0);
    const at75 = lookupPercentage(5, 7.5);
    const at725 = lookupPercentage(5, 7.25);
    expect(at725).toBeCloseTo((at7 + at75) / 2, 3);
  });

  it('interpolates between rep rows (4.5 reps between 4 and 5)', () => {
    const at4 = lookupPercentage(4, 8);
    const at5 = lookupPercentage(5, 8);
    const at45 = lookupPercentage(4.5, 8);
    expect(at45).toBeCloseTo((at4 + at5) / 2, 3);
  });

  it('clamps reps below 1 to row 1', () => {
    expect(lookupPercentage(0.5, 8)).toBeCloseTo(lookupPercentage(1, 8), 3);
  });

  it('clamps reps above 12 to row 12', () => {
    expect(lookupPercentage(15, 8)).toBeCloseTo(lookupPercentage(12, 8), 3);
  });

  it('clamps RPE below 6 to column 6.0', () => {
    expect(lookupPercentage(5, 5)).toBeCloseTo(lookupPercentage(5, 6.0), 3);
  });

  it('clamps RPE above 10 to column 10.0', () => {
    expect(lookupPercentage(5, 11)).toBeCloseTo(lookupPercentage(5, 10.0), 3);
  });
});
