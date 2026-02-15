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
});
