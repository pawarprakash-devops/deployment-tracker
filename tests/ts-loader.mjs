// Minimal ESM loader so `node --test` can import the project's .ts modules without adding a dependency:
// it transpiles .ts on the fly with the `typescript` devDependency (type-only; no type checking — `npx tsc --noEmit`
// does that). Usage: node --import ./tests/ts-loader.mjs --test tests/
import { register } from 'node:module';

if (!globalThis.__trackerTsLoader) {
  globalThis.__trackerTsLoader = true;
  register(import.meta.url, import.meta.url);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
  const [{ readFile }, { fileURLToPath }, ts] = await Promise.all([
    import('node:fs/promises'),
    import('node:url'),
    import('typescript'),
  ]);
  const src = await readFile(fileURLToPath(url), 'utf8');
  const out = ts.default.transpileModule(src, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.default.ModuleKind.ESNext, target: ts.default.ScriptTarget.ES2022 },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}
