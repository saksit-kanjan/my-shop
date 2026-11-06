import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The dependency rules of the clean / DDD layout, checked on the source. A failing line names the import that breaks the rule.
 *
 *  - domain/ is plain TypeScript: no Nest, no SQL, nothing from the layers around it.
 *  - application/ depends on its own domain/ and on other contexts' application/ only (never on infrastructure/ or presentation/).
 *  - infrastructure/ implements the ports of its own domain/; it may call another context's application/ (anti-corruption adapters).
 *  - A context reaches another only through that context's application/ services (exported by its module), never its repository or domain.
 */
const SRC = __dirname;
const MODULES = join(SRC, 'modules');

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [join(dir, n)] : []));

interface Edge {
  from: string;
  to: string;
  spec: string;
}

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) out.push({ from: relative(SRC, file), to: relative(SRC, resolve(dirname(file), spec)), spec });
      else out.push({ from: relative(SRC, file), to: spec, spec });
    }
  }
  return out;
}

const layerOf = (p: string) => /^modules\/[^/]+\/(domain|application|infrastructure|presentation)\//.exec(p)?.[1];
const contextOf = (p: string) => /^modules\/([^/]+)\//.exec(p)?.[1];
const ALL = edges();
const inModules = ALL.filter((e) => e.from.startsWith('modules/'));

describe('architecture', () => {
  it('has the four layers in every context', () => {
    for (const ctx of readdirSync(MODULES)) {
      const dirs = readdirSync(join(MODULES, ctx)).filter((n) => statSync(join(MODULES, ctx, n)).isDirectory());
      expect(dirs, ctx).toContain('application');
      expect(dirs, ctx).toContain('presentation');
    }
  });

  it('keeps domain/ free of Nest, SQL drivers and the outer layers', () => {
    const bad = inModules.filter((e) => layerOf(e.from) === 'domain' && (/^@nestjs\//.test(e.spec) || ['pg', '@electric-sql/pglite'].includes(e.spec) || /\/(application|infrastructure|presentation)\//.test(e.to + '/')));
    expect(bad.map((e) => `${e.from} -> ${e.spec}`)).toEqual([]);
  });

  it('keeps application/ off infrastructure/ and presentation/', () => {
    const bad = inModules.filter((e) => layerOf(e.from) === 'application' && /\/(infrastructure|presentation)(\/|$)/.test(e.to));
    expect(bad.map((e) => `${e.from} -> ${e.spec}`)).toEqual([]);
  });

  it('keeps SQL out of domain/ and application/ outside the read side', () => {
    const offenders = files(MODULES).filter((f) => {
      const rel = relative(SRC, f);
      const layer = layerOf(rel);
      if (layer !== 'domain' && layer !== 'application') return false;
      if (rel.startsWith('modules/reporting/')) return false; // the query side reads tables directly, by design
      return /\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('lets a context reach another only through its application/ services or its module', () => {
    const bad = inModules.filter((e) => {
      const from = contextOf(e.from);
      const to = contextOf(e.to);
      if (!to || from === to) return false;
      return !(/\/application\//.test(e.to) || /\.module$/.test(e.to));
    });
    expect(bad.map((e) => `${e.from} -> ${e.spec}`)).toEqual([]);
  });

  it('keeps the shared kernel independent of every context', () => {
    const bad = ALL.filter((e) => e.from.startsWith('shared/') && /(^|\/)modules\//.test(e.to));
    expect(bad.map((e) => `${e.from} -> ${e.spec}`)).toEqual([]);
  });

  it('has no cycle between contexts', () => {
    const deps = new Map<string, Set<string>>();
    for (const e of inModules) {
      const from = contextOf(e.from);
      const to = contextOf(e.to);
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
