import {
  BOXES,
  LAYOUT_VERSION,
  defaultLayout,
  mergeLayout,
  moveBox,
  resizeBox,
} from './dashboard-layout';

describe('dashboard layout (§1.3b)', () => {
  it('defaults to the zone order B to K', () => {
    const zones = defaultLayout().map((b) => BOXES.find((d) => d.id === b.id)!.zone);
    expect(zones.join('')).toBe('BBBBCDDDEFFFGHIJK');
  });

  it('falls back to the default for a missing or outdated layout', () => {
    expect(mergeLayout(null)).toEqual(defaultLayout());
    expect(mergeLayout({ version: LAYOUT_VERSION + 1, boxes: [] })).toEqual(defaultLayout());
  });

  it('keeps the saved order, drops unknown boxes and clamps sizes', () => {
    const merged = mergeLayout({
      version: LAYOUT_VERSION,
      boxes: [
        { id: 'alerts', w: 1, h: 99 },
        { id: 'gone' as any, w: 3, h: 2 },
        ...defaultLayout().filter((b) => b.id !== 'alerts'),
      ],
    });
    expect(merged[0]).toEqual({ id: 'alerts', w: 3, h: 20 });
    expect(merged.some((b) => (b.id as string) === 'gone')).toBeFalse();
    expect(merged.length).toBe(BOXES.length);
  });

  it('slots a box the saved copy never saw after its default neighbour', () => {
    const saved = defaultLayout().filter((b) => b.id !== 'eod');
    const merged = mergeLayout({ version: LAYOUT_VERSION, boxes: saved });
    const i = merged.findIndex((b) => b.id === 'eod');
    expect(merged[i - 1].id).toBe('insight');
  });

  it('moves a box before or after another', () => {
    const l = defaultLayout();
    const before = moveBox(l, 'alerts', 'total-sales', false);
    expect(before[0].id).toBe('alerts');
    const after = moveBox(l, 'total-sales', 'bills', true);
    expect(after.slice(0, 2).map((b) => b.id)).toEqual(['bills', 'total-sales']);
  });

  it('never resizes below the minimum or past the grid', () => {
    const l = resizeBox(defaultLayout(), 'profit', 1, 1);
    expect(l.find((b) => b.id === 'profit')).toEqual({ id: 'profit', w: 3, h: 2 });
    const wide = resizeBox(defaultLayout(), 'profit', 40, 3);
    expect(wide.find((b) => b.id === 'profit')).toEqual({ id: 'profit', w: 12, h: 3 });
  });
});
