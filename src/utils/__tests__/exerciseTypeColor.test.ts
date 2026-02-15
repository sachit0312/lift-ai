import { exerciseTypeColor } from '../exerciseTypeColor';
import { colors } from '../../theme';

describe('exerciseTypeColor', () => {
  it('returns primary color for weighted', () => {
    expect(exerciseTypeColor('weighted')).toBe(colors.primary);
  });

  it('returns success color for bodyweight', () => {
    expect(exerciseTypeColor('bodyweight')).toBe(colors.success);
  });

  it('returns warning color for machine', () => {
    expect(exerciseTypeColor('machine')).toBe(colors.warning);
  });

  it('returns accent color for cable', () => {
    expect(exerciseTypeColor('cable')).toBe(colors.accent);
  });

  it('returns textMuted color for undefined type', () => {
    expect(exerciseTypeColor(undefined)).toBe(colors.textMuted);
  });

  it('returns textMuted color when called with no arguments', () => {
    expect(exerciseTypeColor()).toBe(colors.textMuted);
  });
});
