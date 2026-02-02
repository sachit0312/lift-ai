import { colors } from '../theme';
import type { ExerciseType } from '../types/database';

export function exerciseTypeColor(type?: ExerciseType): string {
  switch (type) {
    case 'weighted': return colors.primary;
    case 'bodyweight': return colors.success;
    case 'machine': return colors.warning;
    case 'cable': return colors.accent;
    default: return colors.textMuted;
  }
}
