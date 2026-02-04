/**
 * Calculate estimated 1RM using Epley formula
 * @param weight - Weight lifted
 * @param reps - Number of reps completed
 * @returns Estimated 1 rep max
 */
export function calculateEstimated1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}
