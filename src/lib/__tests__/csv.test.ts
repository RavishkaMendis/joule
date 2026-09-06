import { toCsv, parseCsv } from '../csv';

describe('csv codec', () => {
  it('round-trips simple rows', () => {
    const rows = [
      { a: '1', b: 'hello', c: '3.5' },
      { a: '2', b: 'world', c: '4.5' },
    ];
    const csv = toCsv(rows, ['a', 'b', 'c']);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('quotes and round-trips a field containing a comma', () => {
    const rows = [{ name: 'Rice, cooked', kcal: '130' }];
    const csv = toCsv(rows, ['name', 'kcal']);
    expect(csv).toContain('"Rice, cooked"');
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('escapes and round-trips a field containing a double quote', () => {
    const rows = [{ name: 'Mum\'s "famous" dal', kcal: '400' }];
    const csv = toCsv(rows, ['name', 'kcal']);
    expect(csv).toContain('"Mum\'s ""famous"" dal"');
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('round-trips a field containing an embedded newline', () => {
    const rows = [{ notes: 'line one\nline two', x: '1' }];
    const csv = toCsv(rows, ['notes', 'x']);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('round-trips a field containing comma AND quote together', () => {
    const rows = [{ name: 'Ghee, "clarified", 40g', kcal: '360' }];
    const csv = toCsv(rows, ['name', 'kcal']);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('treats null/undefined values as empty fields', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']);
    expect(parseCsv(csv)).toEqual([{ a: '', b: '', c: '0' }]);
  });

  it('parses CSV with no trailing newline after the last row', () => {
    const csv = 'a,b\r\n1,2';
    expect(parseCsv(csv)).toEqual([{ a: '1', b: '2' }]);
  });

  it('parses an empty data set (header only) as zero rows', () => {
    const csv = toCsv([], ['a', 'b']);
    expect(parseCsv(csv)).toEqual([]);
  });

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('a,b\r\n"unterminated,2')).toThrow();
  });
});
