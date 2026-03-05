/**
 * Tuchscherer-style RPE percentage lookup table.
 * Maps (reps, RPE) → percentage of 1RM (0-1 scale).
 * Validated by Zourdos et al. (2016) and aligned with RTS published values.
 *
 * Rows: reps 1-12
 * Columns: RPE 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0
 */

// RPE columns in order (index 0 = RPE 6.0, index 8 = RPE 10.0)
const RPE_COLUMNS = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0] as const;

// Each row is reps 1-12, each value is %1RM at that (reps, RPE) combination.
// Values from the published Tuchscherer/RTS table, verified against liftlog.plus/rpe-calculator
// and rpecalculator.com. Each RPE step shifts the grid diagonally.
const TABLE: number[][] = [
  // RPE:  6.0    6.5    7.0    7.5    8.0    8.5    9.0    9.5   10.0
  /* 1 */ [0.863, 0.878, 0.892, 0.907, 0.922, 0.939, 0.955, 0.978, 1.000],
  /* 2 */ [0.837, 0.850, 0.863, 0.878, 0.892, 0.907, 0.922, 0.939, 0.955],
  /* 3 */ [0.811, 0.824, 0.837, 0.850, 0.863, 0.878, 0.892, 0.907, 0.922],
  /* 4 */ [0.786, 0.799, 0.811, 0.824, 0.837, 0.850, 0.863, 0.878, 0.892],
  /* 5 */ [0.762, 0.774, 0.786, 0.799, 0.811, 0.824, 0.837, 0.850, 0.863],
  /* 6 */ [0.739, 0.751, 0.762, 0.774, 0.786, 0.799, 0.811, 0.824, 0.837],
  /* 7 */ [0.707, 0.723, 0.739, 0.751, 0.762, 0.774, 0.786, 0.799, 0.811],
  /* 8 */ [0.680, 0.694, 0.707, 0.723, 0.739, 0.751, 0.762, 0.774, 0.786],
  /* 9 */ [0.653, 0.667, 0.680, 0.694, 0.707, 0.723, 0.739, 0.751, 0.762],
  /* 10*/ [0.626, 0.640, 0.653, 0.667, 0.680, 0.694, 0.707, 0.723, 0.739],
  /* 11*/ [0.599, 0.613, 0.626, 0.640, 0.653, 0.667, 0.680, 0.694, 0.707],
  /* 12*/ [0.574, 0.586, 0.599, 0.613, 0.626, 0.640, 0.653, 0.667, 0.680],
];

const MIN_REPS = 1;
const MAX_REPS = 12;
const MIN_RPE = 6.0;
const MAX_RPE = 10.0;

/**
 * Look up the percentage of 1RM for a given (reps, RPE) combination.
 * Uses bilinear interpolation for non-exact values.
 *
 * @param reps - Number of reps (clamped to 1-12)
 * @param rpe - Rate of Perceived Exertion (clamped to 6-10)
 * @returns Percentage of 1RM as a decimal (0-1 scale), e.g., 0.837 = 83.7%
 */
export function lookupPercentage(reps: number, rpe: number): number {
  // Clamp inputs to table bounds
  const clampedReps = Math.max(MIN_REPS, Math.min(MAX_REPS, reps));
  const clampedRpe = Math.max(MIN_RPE, Math.min(MAX_RPE, rpe));

  // Find bounding rows (reps)
  const rowIdx = clampedReps - 1; // 1-indexed reps → 0-indexed array
  const rowLow = Math.floor(rowIdx);
  const rowHigh = Math.min(rowLow + 1, TABLE.length - 1);
  const rowFrac = rowIdx - rowLow;

  // Find bounding columns (RPE)
  const rpeStep = 0.5;
  const colIdx = (clampedRpe - MIN_RPE) / rpeStep;
  const colLow = Math.floor(colIdx);
  const colHigh = Math.min(colLow + 1, RPE_COLUMNS.length - 1);
  const colFrac = colIdx - colLow;

  // Bilinear interpolation
  const topLeft = TABLE[rowLow][colLow];
  const topRight = TABLE[rowLow][colHigh];
  const bottomLeft = TABLE[rowHigh][colLow];
  const bottomRight = TABLE[rowHigh][colHigh];

  const top = topLeft + (topRight - topLeft) * colFrac;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * colFrac;

  return top + (bottom - top) * rowFrac;
}
