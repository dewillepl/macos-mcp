#!/usr/bin/env node
/**
 * Build the macos-mcp .mcpb bundle.
 *
 * Output: dist-mcpb/macos-mcp-${version}.mcpb
 *
 * Layout inside the bundle:
 *   manifest.json
 *   server/
 *     package.json            (needed by findProjectRoot)
 *     index.js                (entry point, from dist/)
 *     <flattened dist tree>
 *     bin/EventKitCLI         (universal binary, pre-built)
 *     node_modules/           (prod deps only)
 */
import { exec, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const STAGING = path.join(ROOT, 'mcpb-build');
const OUTPUT_DIR = path.join(ROOT, 'dist-mcpb');

const log = (msg) => console.log(`[mcpb] ${msg}`);

const run = (cmd, cwd = ROOT) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, { cwd, shell: true, stdio: 'inherit' });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });

async function copyDir(src, dst, filter = () => true) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (!filter(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath, filter);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

async function main() {
  log('Cleaning staging directory...');
  await fs.rm(STAGING, { recursive: true, force: true });
  await fs.mkdir(STAGING, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  log('Building TypeScript...');
  await run('pnpm run build:ts');

  log('Building universal Swift binary...');
  await run('node scripts/build-swift-universal.mjs');

  log('Reading package.json for version sync...');
  const pkg = JSON.parse(
    await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
  );

  log(`Staging server directory (version ${pkg.version})...`);
  const serverDir = path.join(STAGING, 'server');
  await fs.mkdir(serverDir, { recursive: true });

  // Flatten dist/ into server/ — keeps findProjectRoot working
  // (it walks up from the running module looking for package.json with name=mcp-macos)
  await copyDir(path.join(ROOT, 'dist'), serverDir, (src) => {
    if (src.endsWith('.test.js') || src.endsWith('.test.js.map')) return false;
    if (src.endsWith('.d.ts') || src.endsWith('.js.map')) return false;
    if (src.includes('test-setup.')) return false;
    return true;
  });

  // Copy Swift binary
  await fs.mkdir(path.join(serverDir, 'bin'), { recursive: true });
  await fs.copyFile(
    path.join(ROOT, 'bin', 'EventKitCLI'),
    path.join(serverDir, 'bin', 'EventKitCLI'),
  );
  await fs.chmod(path.join(serverDir, 'bin', 'EventKitCLI'), 0o755);

  // Minimal package.json for findProjectRoot recognition + dep install
  const minimalPkg = {
    name: pkg.name,
    version: pkg.version,
    type: 'module',
    main: 'index.js',
    dependencies: pkg.dependencies,
  };
  await fs.writeFile(
    path.join(serverDir, 'package.json'),
    JSON.stringify(minimalPkg, null, 2),
  );

  log('Installing production dependencies...');
  await run('npm install --omit=dev --no-package-lock --silent', serverDir);

  log('Syncing manifest version from package.json...');
  const manifestSrc = JSON.parse(
    await fs.readFile(path.join(ROOT, 'mcpb', 'manifest.json'), 'utf8'),
  );
  manifestSrc.version = pkg.version;
  await fs.writeFile(
    path.join(STAGING, 'manifest.json'),
    JSON.stringify(manifestSrc, null, 2),
  );

  log('Validating manifest...');
  await run('npx --yes @anthropic-ai/mcpb validate manifest.json', STAGING);

  log('Packing bundle...');
  const outputFile = path.join(OUTPUT_DIR, `macos-mcp-${pkg.version}.mcpb`);
  await run(`npx --yes @anthropic-ai/mcpb pack . "${outputFile}"`, STAGING);

  const stat = await fs.stat(outputFile);
  log(
    `Bundle ready: ${outputFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error('[mcpb] Build failed:', err);
  process.exit(1);
});
