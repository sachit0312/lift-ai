import { getSetTagLabel, getSetTagColor } from '../setTagUtils';
import { colors } from '../../theme';

describe('getSetTagLabel', () => {
  it('returns "W" for warmup', () => {
    expect(getSetTagLabel('warmup')).toBe('W');
  });

  it('returns "F" for failure', () => {
    expect(getSetTagLabel('failure')).toBe('F');
  });

  it('returns "D" for drop', () => {
    expect(getSetTagLabel('drop')).toBe('D');
  });

  it('returns null for working (default)', () => {
    expect(getSetTagLabel('working')).toBeNull();
  });
});

describe('getSetTagColor', () => {
  it('returns warning color for warmup', () => {
    expect(getSetTagColor('warmup')).toBe(colors.warning);
  });

  it('returns error color for failure', () => {
    expect(getSetTagColor('failure')).toBe(colors.error);
  });

  it('returns primary color for drop', () => {
    expect(getSetTagColor('drop')).toBe(colors.primary);
  });

  it('returns undefined for working (default)', () => {
    expect(getSetTagColor('working')).toBeUndefined();
  });
});
