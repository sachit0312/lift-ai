import { calculateEstimated1RM } from '../oneRepMax';

describe('calculateEstimated1RM', () => {
  it('calculates 1RM using Epley formula', () => {
    // 100 * (1 + 10/30) = 100 * 1.333... = 133.33...
    expect(calculateEstimated1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it('returns weight when reps is 0', () => {
    // weight * (1 + 0/30) = weight * 1 = weight
    expect(calculateEstimated1RM(200, 0)).toBe(200);
  });

  it('returns 0 when weight is 0', () => {
    // 0 * (1 + 5/30) = 0
    expect(calculateEstimated1RM(0, 5)).toBe(0);
  });

  it('calculates correctly for 1 rep', () => {
    // 100 * (1 + 1/30) = 100 * 1.0333... = 103.33...
    expect(calculateEstimated1RM(100, 1)).toBeCloseTo(103.33, 1);
  });

  it('handles large values', () => {
    // 500 * (1 + 20/30) = 500 * 1.666... = 833.33...
    expect(calculateEstimated1RM(500, 20)).toBeCloseTo(833.33, 1);
  });

  it('returns 0 when both weight and reps are 0', () => {
    expect(calculateEstimated1RM(0, 0)).toBe(0);
  });

  it('handles decimal weight values', () => {
    // 67.5 * (1 + 8/30) = 67.5 * 1.2666... = 85.5
    expect(calculateEstimated1RM(67.5, 8)).toBeCloseTo(85.5, 1);
  });

  it('adjusts for RPE when provided', () => {
    // RPE 8 → RIR = 2, effective_reps = 5 + 2 = 7
    // 100 * (1 + 7/30) = 100 * 1.2333... = 123.33...
    expect(calculateEstimated1RM(100, 5, 8)).toBeCloseTo(123.33, 1);
  });

  it('uses standard Epley when RPE is null', () => {
    // Same as without RPE: 100 * (1 + 5/30) = 116.67
    expect(calculateEstimated1RM(100, 5, null)).toBeCloseTo(116.67, 1);
  });

  it('uses standard Epley when RPE is undefined', () => {
    expect(calculateEstimated1RM(100, 5, undefined)).toBeCloseTo(116.67, 1);
  });

  it('handles RPE 10 (no reps in reserve)', () => {
    // RPE 10 → RIR = 0, effective_reps = reps + 0 = reps (same as standard)
    expect(calculateEstimated1RM(100, 5, 10)).toBeCloseTo(116.67, 1);
  });

  it('handles RPE 6 (4 reps in reserve)', () => {
    // RPE 6 → RIR = 4, effective_reps = 5 + 4 = 9
    // 100 * (1 + 9/30) = 100 * 1.3 = 130
    expect(calculateEstimated1RM(100, 5, 6)).toBe(130);
  });
});
