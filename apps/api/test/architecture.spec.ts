import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The clean-architecture rules of the standard Nest layout, checked on the source. A failing line names the import that breaks the rule.
 *
 *  - entities/ and policies/ are plain TypeScript: no Nest, no SQL driver, no services, controllers or adapters.
 *  - Services (the use cases) depend on repository PORTS (abstract classes), never on the pg-* adapters.
 *  - SQL stays in repositories/pg-*, database/, seeds and the reporting read side.
 *  - A feature reaches another only through its *.service.ts or *.module.ts, never its repositories, policies or entities.
 *  - common/, database/, audit/ and numbering/ import no feature, and there is no cycle between features.
 */
const SRC = join(__dirname, '..', 'src');
const INFRA = ['common', 'database', 'audit', 'numbering', 'jobs'];

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [join(dir, n)] : []));
const features = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory() && !INFRA.includes(n));

interface Edge { from: string; to: string; spec: string }
const edges: Edge[] = files(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => ({
    from: relative(SRC, file),
    to: m[1].startsWith('.') ? relative(SRC, resolve(dirname(file), m[1])) : m[1],
    spec: m[1],
  }));
});

const featureOf = (p: string) => (features.includes(p.split('/')[0]) ? p.split('/')[0] : undefined);
const folderOf = (p: string) => p.split('/')[1];
const lint = (bad: Edge[]) => bad.map((e) => `${e.from} -> ${e.spec}`);

describe('architecture', () => {
  it('has the standard Nest files in every feature', () => {
    for (const f of features) {
      const names = readdirSync(join(SRC, f));
      expect(names, f).toContain(`${f}.module.ts`);
      expect(names.some((n) => n.endsWith('.service.ts')), `${f} needs a service`).toBe(true);
    }
  });

  it('keeps entities/ and policies/ free of Nest, SQL drivers and the outer layers', () => {
    const bad = edges.filter((e) => ['entities', 'policies'].includes(folderOf(e.from)) && featureOf(e.from) && (/^@nestjs\//.test(e.spec) || ['pg', '@electric-sql/pglite'].includes(e.spec) || /\.(service|controller|module)$/.test(e.to) || /\/(repositories|providers|guards)\//.test(`/${e.to}`)));
    expect(lint(bad)).toEqual([]);
  });

  it('keeps services and controllers off the pg-* adapters', () => {
    const bad = edges.filter((e) => /\.(service|controller)\.ts$/.test(e.from) && /\/pg-[^/]+$|\/pg-db$|\/pglite-db$/.test(`/${e.to}`));
    expect(lint(bad)).toEqual([]);
  });

  it('keeps SQL in repositories/pg-*, database/, and the reporting read side', () => {
    const offenders = files(SRC).map((f) => relative(SRC, f)).filter((rel) => {
      const allowed = /\/repositories\/pg-/.test(`/${rel}`) || rel.startsWith('database/') || rel.startsWith('audit/') || rel.startsWith('numbering/') || rel.startsWith('reporting/');
      return !allowed && /\b(SELECT\s|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(readFileSync(join(SRC, rel), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('lets a feature reach another only through its service or module', () => {
    const bad = edges.filter((e) => {
      const from = featureOf(e.from);
      const to = featureOf(e.to);
      return !!from && !!to && from !== to && !/\.(service|module)$/.test(e.to);
    });
    // The auth guard and decorators are shared plumbing, imported by the root module only.
    expect(lint(bad.filter((e) => e.from !== 'app.module.ts'))).toEqual([]);
  });

  it('keeps common/, database/, audit/ and numbering/ independent of every feature', () => {
    const bad = edges.filter((e) => INFRA.filter((d) => d !== 'jobs').includes(e.from.split('/')[0]) && !e.from.startsWith('database/seeds/') && featureOf(e.to)); // the demo seed is bootstrap code, not part of the app graph
    expect(lint(bad)).toEqual([]);
  });

  it('has no cycle between features', () => {
    const deps = new Map<string, Set<string>>();
    for (const e of edges) {
      const from = featureOf(e.from);
      const to = featureOf(e.to);
      if (from && to && from !== to) deps.set(from, (deps.get(from) ?? new Set()).add(to));
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
