// Emergency information must stay readable: white text on every risk-coloured card has to meet WCAG AA (4.5:1 for normal text),
// the four risk levels must be visually distinct, and the motion helpers must stay bounded so nothing delays an emergency action.
jest.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default }, StatusBar: { currentHeight: 24 } }), { virtual: true });

const { RISK, riskColor, riskSurface, riskIndex } = require('../src/theme');
const { staggerDelay } = require('../src/components/motion.js');

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('risk colours', () => {
  test.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('white text on the %s card meets WCAG AA', (level) => {
    expect(contrast('#FFFFFF', RISK[level].surface)).toBeGreaterThanOrEqual(4.5);
  });

  test('the four levels are distinct and ordered', () => {
    const tones = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((l) => riskColor(l));
    expect(new Set(tones).size).toBe(4);
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(riskIndex)).toEqual([0, 1, 2, 3]);
    expect(riskColor('MODERATE')).toBe(riskColor('MEDIUM'));          // the older name still maps to MEDIUM
    expect(riskSurface('not-a-level')).toBe(RISK.LOW.surface);        // unknown input never throws
  });
});

describe('motion helpers', () => {
  test('stagger delays are capped so a long list never makes people wait', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBe(210);
    expect(staggerDelay(100)).toBe(420);
    expect(staggerDelay(100, 50, 300)).toBe(300);
  });
});
