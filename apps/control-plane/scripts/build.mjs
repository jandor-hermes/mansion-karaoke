import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const app = resolve(import.meta.dirname, '..');
const root = resolve(app, '../..');
const out = join(app, 'dist');
await rm(out, { recursive: true, force: true });

const files = [
  ...ts.sys.readDirectory(join(app, 'src'), ['.ts'], undefined, ['**/*.ts']),
  ...ts.sys.readDirectory(join(root, 'packages/playback-protocol/src'), ['.ts'], undefined, ['**/*.ts']),
];
for (const file of files) {
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`unable to read ${file}`);
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: false }, fileName: file });
  const output = result.outputText.replace("../../../packages/playback-protocol/src'", "../../../packages/playback-protocol/src/index.js'");
  const destination = join(out, relative(root, file)).replace(/\.ts$/, '.js');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, output);
}

const zod = resolve(root, 'node_modules/.bun/zod@3.25.76/node_modules/zod');
await mkdir(join(out, 'node_modules'), { recursive: true });
await cp(zod, join(out, 'node_modules/zod'), { recursive: true });
await cp(join(root, 'packages/playback-protocol/src/index.ts'), join(out, 'packages/playback-protocol/src/index.ts'));
console.log(`built ${files.length} TypeScript files to ${out}`);
