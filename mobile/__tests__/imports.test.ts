// Static guard: every named import from a local module must be something that module really exports. A wrong import in a plain
// JavaScript screen is otherwise only found when the screen renders and crashes (a blank screen).
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');
const EXTS = ['.js', '.ts', '.tsx', '/index.js', '/index.ts', '/index.tsx'];

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return /\.(js|ts|tsx)$/.test(e.name) ? [p] : [];
});

const resolve = (from: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(from), spec);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const x of EXTS) if (fs.existsSync(base + x)) return base + x;
  return null;
};

const exportsOf = (file: string, seen = new Set<string>()): Set<string> | 'ANY' => {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s+(?:type|interface|enum)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}(?:\s*from\s*'([^']+)')?/g)) {
    for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  }
  if (/export\s+default\b/.test(text)) names.add('default');
  if (/export\s*\*\s*from/.test(text) || /module\.exports/.test(text)) return 'ANY';
  return names;
};

describe('local named imports', () => {
  const problems: string[] = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s+(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = resolve(file, m[2]);
      if (!target || !/\.(js|ts|tsx)$/.test(target)) continue;           // assets, json, native modules
      const have = exportsOf(target);
      if (have === 'ANY') continue;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
        if (name && !have.has(name)) problems.push(`${path.relative(SRC, file)} imports { ${name} } from '${m[2]}' but it is not exported there`);
      }
    }
  }
  test('every imported name exists in the module it comes from', () => { expect(problems).toEqual([]); });
  test('the scan actually looked at the app', () => { expect(walk(SRC).length).toBeGreaterThan(60); });
});
