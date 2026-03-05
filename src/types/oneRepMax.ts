export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface E1RMResult {
  /** Estimated 1RM value */
  value: number;
  /** Confidence tier based on rep range and RPE availability */
  confidence: ConfidenceTier;
  /** Which calculation path was used */
  method: 'rpe_table' | 'ensemble';
  /** Expected error margin as a percentage (e.g., 3 = ±3%) */
  marginPercent: number;
}
