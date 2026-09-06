import { windowStartDate, isWithinWindow } from '../dashboardWindow';

describe('windowStartDate', () => {
  it('4w is 28 days inclusive, ending today', () => {
    expect(windowStartDate('4w', '2026-09-05')).toBe('2026-08-09');
  });

  it('12w is 84 days inclusive, ending today', () => {
    expect(windowStartDate('12w', '2026-09-05')).toBe('2026-06-14');
  });

  it('all has no lower bound', () => {
    expect(windowStartDate('all', '2026-09-05')).toBeNull();
  });
});

describe('isWithinWindow', () => {
  it('excludes dates after the end', () => {
    expect(isWithinWindow('2026-09-06', '2026-08-01', '2026-09-05')).toBe(false);
  });

  it('excludes dates before the start', () => {
    expect(isWithinWindow('2026-07-31', '2026-08-01', '2026-09-05')).toBe(false);
  });

  it('includes dates on the boundary', () => {
    expect(isWithinWindow('2026-08-01', '2026-08-01', '2026-09-05')).toBe(true);
    expect(isWithinWindow('2026-09-05', '2026-08-01', '2026-09-05')).toBe(true);
  });

  it('null start means unbounded below', () => {
    expect(isWithinWindow('2001-01-01', null, '2026-09-05')).toBe(true);
  });
});
