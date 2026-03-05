/**
 * Estimated 1RM calculation engine.
 *
 * Two paths:
 *   1. RPE provided → Tuchscherer-style lookup table (most accurate)
 *   2. No RPE → Rep-range-weighted ensemble of Epley + Brzycki + Wathen
 *
 * Also provides confidence scoring for PR gating.
 */

import { lookupPercentage } from '../data/rpeTable';
import type { ConfidenceTier, E1RMResult } from '../types/oneRepMax';

// ─── Constants ───

/** Half-life for freshness weighting of e1RM estimates (in days). */
export const FRESHNESS_HALF_LIFE_DAYS = 42; // 6 weeks

// ─── Individual Formulas ───

function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function brzycki(weight: number, reps: number): number {
  if (reps >= 36) return weight; // formula undefined at 37+
  return weight * (36 / (37 - reps));
}

function wathen(weight: number, reps: number): number {
  return (100 * weight) / (48.8 + 53.8 * Math.exp(-0.075 * reps));
}

// ─── Ensemble Weights by Rep Range ───

interface FormulaWeights { brzycki: number; epley: number; wathen: number }

function getEnsembleWeights(reps: number): FormulaWeights {
  if (reps <= 5)  return { brzycki: 0.50, epley: 0.20, wathen: 0.30 };
  if (reps <= 10) return { brzycki: 0.30, epley: 0.40, wathen: 0.30 };
  return                   { brzycki: 0.25, epley: 0.35, wathen: 0.40 };
}

function ensembleEstimate(weight: number, reps: number): number {
  const w = getEnsembleWeights(reps);
  return w.brzycki * brzycki(weight, reps)
       + w.epley   * epley(weight, reps)
       + w.wathen  * wathen(weight, reps);
}

// ─── Confidence Scoring ───

function getConfidence(reps: number, rpe: number | null | undefined): { tier: ConfidenceTier; margin: number } {
  if (reps === 1 && (rpe == null || rpe >= 9)) return { tier: 'high', margin: 0 };  // near-max single
  if (rpe != null && rpe >= 7 && reps <= 5)    return { tier: 'high', margin: 3 };
  if (reps <= 10)                              return { tier: 'medium', margin: 6 };
  return                                              { tier: 'low', margin: 12 };
}

// ─── PR Gating Margins ───

const PR_GATING_MARGINS: Record<ConfidenceTier, number> = {
  high: 0,      // any improvement counts
  medium: 0.01, // must beat by 1%
  low: 0.03,    // must beat by 3%
};

/** Returns the multiplier above bestE1RM that must be exceeded for a PR at this confidence tier. */
export function getPRGatingMargin(confidence: ConfidenceTier): number {
  return PR_GATING_MARGINS[confidence];
}

// ─── Main API ───

/**
 * Calculate estimated 1RM with full metadata.
 *
 * When RPE is provided: uses Tuchscherer percentage table (most accurate).
 * When RPE is absent: uses rep-range-weighted ensemble of Epley + Brzycki + Wathen.
 */
export function calculateE1RM(weight: number, reps: number, rpe?: number | null): E1RMResult {
  if (weight <= 0) {
    return { value: 0, confidence: 'low', method: 'ensemble', marginPercent: 12 };
  }

  // 0 reps = just the weight itself (edge case: unfinished set)
  if (reps <= 0) {
    return { value: weight, confidence: 'high', method: rpe != null ? 'rpe_table' : 'ensemble', marginPercent: 0 };
  }

  const { tier, margin } = getConfidence(reps, rpe);

  if (rpe != null) {
    // Path A: RPE-based Tuchscherer table lookup
    const percentage = lookupPercentage(reps, rpe);
    const value = percentage > 0 ? weight / percentage : 0;
    return { value, confidence: tier, method: 'rpe_table', marginPercent: margin };
  }

  // Path B: No RPE — ensemble of formulas
  const value = ensembleEstimate(weight, reps);
  return { value, confidence: tier, method: 'ensemble', marginPercent: margin };
}

/**
 * Backwards-compatible function — returns just the number.
 * Drop-in replacement for the original Epley-only function.
 * All existing callers use this signature.
 */
export function calculateEstimated1RM(weight: number, reps: number, rpe?: number | null): number {
  return calculateE1RM(weight, reps, rpe).value;
}
