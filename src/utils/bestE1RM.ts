import { calculateE1RM } from './oneRepMax';
import type { LocalSet } from '../types/workout';

/**
 * Recomputes the running best e1RM for one exercise from the sets still completed in this
 * session, floored at the pre-workout all-time best.
 *
 * The revert paths (un-checking a PR set, deleting a PR set) used to assign the pre-workout
 * best directly. That silently discarded any OTHER PR still standing in the session: with a
 * 300 all-time best, hitting 310 then 325 and then un-checking the 310 set reset the running
 * best to 300 even though the 325 set was still completed — so a later 305 fired a PR badge,
 * confetti and haptics for what was actually a regression.
 *
 * RPE handling matches the completion path: failure-tagged sets are treated as RPE 10, and a
 * blank RPE is passed as null so the no-RPE ensemble formula is used.
 */
export function recomputeSessionBestE1RM(
  sets: LocalSet[],
  originalBest: number | undefined,
  excludeSetId?: string,
): number | undefined {
  let best = originalBest;

  for (const s of sets) {
    if (!s.is_completed) continue;
    if (excludeSetId !== undefined && s.id === excludeSetId) continue;

    const weight = Number(s.weight);
    const reps = Number(s.reps);
    if (!(weight > 0 && reps > 0)) continue;

    const rpe = s.tag === 'failure' ? 10 : (s.rpe ? Number(s.rpe) : null);
    const { value } = calculateE1RM(weight, reps, rpe);
    if (best == null || value > best) best = value;
  }

  return best;
}
