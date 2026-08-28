#!/usr/bin/env node
/**
 * Build a universal (arm64 + x86_64) Swift binary for MCPB distribution.
 *
 * The default build-swift.mjs produces a host-arch binary, which is correct
 * for npm installs (postinstall compiles on the user's machine). MCPB bundles
 * ship pre-built, so the binary must run on any Mac — universal is required.
 *
 * Strategy: compile each arch separately (each with its own Info.plist
 * embedded via -Xlinker -sectcreate), then merge with lipo.
 */
import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function main() {
  if (process.platform !== 'darwin') {
    console.error('Error: Universal Swift build requires macOS.');
    process.exit(1);
  }

  try {
    await execAsync('which swiftc && which lipo');
  } catch {
    console.error(
      'Error: swiftc and lipo are required. Install Xcode Command Line Tools.',
    );
    process.exit(1);
  }

  const packageRoot = path.resolve(
    new URL('.', import.meta.url).pathname,
    '..',
  );
  const swiftDir = path.resolve(packageRoot, 'src', 'swift');
  const sourceFile = path.join(swiftDir, 'EventKitCLI.swift');
  const infoPlistFile = path.join(swiftDir, 'Info.plist');
  const binDir = path.resolve(packageRoot, 'bin');
  const outputFile = path.join(binDir, 'EventKitCLI');
  const arm64Output = path.join(binDir, 'EventKitCLI.arm64');
  const x86Output = path.join(binDir, 'EventKitCLI.x86_64');

  await fs.mkdir(binDir, { recursive: true });

  const compileForArch = async (target, output) => {
    const cmd = [
      'swiftc',
      `-target ${target}`,
      `-o "${output}"`,
      `"${sourceFile}"`,
      '-framework EventKit',
      '-framework Foundation',
      '-framework MapKit',
      '-framework CoreLocation',
      '-framework Contacts',
      '-Xlinker -sectcreate',
      '-Xlinker __TEXT',
      '-Xlinker __info_plist',
      `-Xlinker "${infoPlistFile}"`,
    ].join(' ');
    console.log(`Compiling ${target}...`);
    const { stderr } = await execAsync(cmd);
    if (stderr) console.warn(stderr);
  };

  try {
    await compileForArch('arm64-apple-macos11', arm64Output);
    await compileForArch('x86_64-apple-macos11', x86Output);

    console.log('Merging with lipo...');
    await execAsync(
      `lipo -create "${arm64Output}" "${x86Output}" -output "${outputFile}"`,
    );

    await fs.chmod(outputFile, 0o755);
    await fs.rm(arm64Output, { force: true });
    await fs.rm(x86Output, { force: true });

    const { stdout: fileInfo } = await execAsync(`file "${outputFile}"`);
    console.log(`Universal binary built:\n${fileInfo.trim()}`);
  } catch (error) {
    console.error('Universal build failed:', error);
    process.exit(1);
  }
}

main();
