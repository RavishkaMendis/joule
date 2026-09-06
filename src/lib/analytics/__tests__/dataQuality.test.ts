import { isWeakerQuality, weakestQuality } from '../dataQuality';

describe('isWeakerQuality', () => {
  test('seeding is weaker than converging', () => {
    expect(isWeakerQuality('seeding', 'converging')).toBe(true);
  });

  test('converging is weaker than stable', () => {
    expect(isWeakerQuality('converging', 'stable')).toBe(true);
  });

  test('seeding is weaker than stable', () => {
    expect(isWeakerQuality('seeding', 'stable')).toBe(true);
  });

  test('a quality is never weaker than itself', () => {
    expect(isWeakerQuality('stable', 'stable')).toBe(false);
    expect(isWeakerQuality('seeding', 'seeding')).toBe(false);
  });

  test('stable is not weaker than seeding (order matters)', () => {
    expect(isWeakerQuality('stable', 'seeding')).toBe(false);
  });
});

describe('weakestQuality', () => {
  test('empty input returns null, not a default quality', () => {
    expect(weakestQuality([])).toBeNull();
  });

  test('single-value input returns that value unchanged', () => {
    expect(weakestQuality(['stable'])).toBe('stable');
    expect(weakestQuality(['seeding'])).toBe('seeding');
    expect(weakestQuality(['converging'])).toBe('converging');
  });

  test('all-stable input returns stable', () => {
    expect(weakestQuality(['stable', 'stable', 'stable'])).toBe('stable');
  });

  test('one seeded value among stable values pulls the result down to seeding', () => {
    expect(weakestQuality(['stable', 'stable', 'seeding', 'stable'])).toBe('seeding');
  });

  test('mixing converging and stable returns converging', () => {
    expect(weakestQuality(['converging', 'stable'])).toBe('converging');
  });

  test('mixing all three returns the overall weakest (seeding)', () => {
    expect(weakestQuality(['stable', 'converging', 'seeding'])).toBe('seeding');
  });

  test('order of inputs does not affect the result', () => {
    expect(weakestQuality(['seeding', 'stable', 'converging'])).toBe('seeding');
    expect(weakestQuality(['converging', 'seeding', 'stable'])).toBe('seeding');
  });
});
