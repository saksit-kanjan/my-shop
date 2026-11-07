import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** A few rules that keep the server plain: it is an API only, controllers stay thin, features do not form cycles. */
const SRC = join(__dirname, '..', 'src');
const SHARED = ['common', 'config', 'database', 'audit'];

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));
const features = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory() && !SHARED.includes(n));

const imports = files(SRC).flatMap((f) =>
  [...readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map((m) => ({ from: relative(SRC, f), to: relative(SRC, resolve(dirname(f), m[1])) })),
);

describe('server structure', () => {
  it('serves no web pages: it is only an API', () => {
    const offenders = files(SRC).filter((f) => /useStaticAssets|serve-static|sendFile/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('keeps controllers thin: no database access in a controller', () => {
    const bad = imports.filter((i) => i.from.endsWith('.controller.ts') && i.to.startsWith('database/'));
    expect(bad.map((i) => `${i.from} -> ${i.to}`)).toEqual([]);
  });

  it('keeps every domain/ folder free of Nest, TypeORM and the database', () => {
    const offenders = files(SRC)
      .filter((f) => relative(SRC, f).split('/').includes('domain'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => ({ f: relative(SRC, f), to: m[1] })))
      .filter(({ to }) => to.startsWith('@nestjs') || to === 'typeorm' || to.startsWith('typeorm/') || to === 'pg' || /(^|\/)(database|entities|infrastructure)(\/|$)/.test(to));
    expect(offenders.map((o) => `${o.f} -> ${o.to}`)).toEqual([]);
  });

  it('has a module, a controller and a service in every feature', () => {
    for (const f of features) {
      const names = readdirSync(join(SRC, f));
      expect(names, f).toContain(`${f}.module.ts`);
      if (f !== 'jobs') {
        expect(names.some((n) => n.endsWith('.service.ts')), `${f} service`).toBe(true);
      }
    }
  });

  it('has no cycle between features', () => {
    const deps = new Map<string, Set<string>>();
    for (const i of imports) {
      const from = i.from.split('/')[0];
      const to = i.to.split('/')[0];
      if (features.includes(from) && features.includes(to) && from !== to) deps.set(from, (deps.get(from) ?? new Set()).add(to));
    }
    const visit = (n: string, path: string[]): string[] | null => {
      if (path.includes(n)) return [...path.slice(path.indexOf(n)), n];
      for (const next of deps.get(n) ?? []) {
        const hit = visit(next, [...path, n]);
        if (hit) return hit;
      }
      return null;
    };
    for (const n of deps.keys()) expect(visit(n, []), `cycle through ${n}`).toBeNull();
  });
});
