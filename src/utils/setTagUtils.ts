import { colors } from '../theme';
import type { SetTag } from '../types/database';

export function getSetTagLabel(tag: SetTag): string | null {
  switch (tag) {
    case 'warmup': return 'W';
    case 'failure': return 'F';
    case 'drop': return 'D';
    default: return null;
  }
}

export function getSetTagColor(tag: SetTag): string | undefined {
  switch (tag) {
    case 'warmup': return colors.warning;
    case 'failure': return colors.error;
    case 'drop': return colors.primary;
    default: return undefined;
  }
}
