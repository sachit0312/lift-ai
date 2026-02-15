/**
 * Calculate estimated 1RM using Epley formula, optionally adjusted for RPE.
 * When RPE is provided: RIR = 10 - RPE, effective_reps = reps + RIR
 * Falls back to standard Epley when RPE is null/undefined.
 * @param weight - Weight lifted
 * @param reps - Number of reps completed
 * @param rpe - Rate of Perceived Exertion (1-10), optional
 * @returns Estimated 1 rep max
 */
export function calculateEstimated1RM(weight: number, reps: number, rpe?: number | null): number {
  const effectiveReps = rpe != null ? reps + (10 - rpe) : reps;
  return weight * (1 + effectiveReps / 30);
}
