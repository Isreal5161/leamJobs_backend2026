import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { jest } from '@jest/globals';

const require = createRequire(import.meta.url);
const {
  generatePrisma,
  resolvePrismaCli,
  resolveRepositoryRoot,
} = require('../scripts/generate-prisma.cjs');

let tempRoot;

function createPrismaProject(root) {
  const schema = path.join(root, 'prisma', 'schema.prisma');
  const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  mkdirSync(path.dirname(schema), { recursive: true });
  mkdirSync(path.dirname(cli), { recursive: true });
  writeFileSync(schema, 'generator client {}');
  writeFileSync(cli, '');
  return { schema, cli };
}

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'generate-prisma-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('Prisma generator helper', () => {
  test('prefers the repository identified by npm_package_json', () => {
    const npmRoot = path.join(tempRoot, 'repository');
    const scriptRoot = path.join(tempRoot, 'other');
    createPrismaProject(npmRoot);
    createPrismaProject(scriptRoot);

    expect(
      resolveRepositoryRoot({
        env: { npm_package_json: path.join(npmRoot, 'package.json') },
        scriptDir: path.join(scriptRoot, 'scripts'),
        cwd: tempRoot,
      }),
    ).toBe(npmRoot);
  });

  test('uses the helper location as a fallback and reports a missing schema', () => {
    const root = path.join(tempRoot, 'repository');
    createPrismaProject(root);

    expect(
      resolveRepositoryRoot({
        env: {},
        scriptDir: path.join(root, 'scripts'),
        cwd: tempRoot,
      }),
    ).toBe(root);

    expect(() =>
      resolveRepositoryRoot({
        env: {},
        scriptDir: path.join(tempRoot, 'missing', 'scripts'),
        cwd: tempRoot,
      }),
    ).toThrow(/Prisma schema not found/);
  });

  test('resolves the Prisma CLI executable directly from repository dependencies', () => {
    const root = path.join(tempRoot, 'repository');
    const { cli } = createPrismaProject(root);

    expect(resolvePrismaCli(root)).toBe(cli);
    expect(() => resolvePrismaCli(tempRoot)).toThrow(/Prisma CLI entry point not found/);
  });

  test('runs Prisma generation from the root with an absolute schema path', () => {
    const root = path.join(tempRoot, 'repository');
    const { schema, cli } = createPrismaProject(root);
    const spawn = jest.fn(() => ({ status: 0 }));
    const env = { npm_package_json: path.join(root, 'package.json') };

    expect(
      generatePrisma({
        env,
        scriptDir: path.join(tempRoot, 'wrong', 'scripts'),
        cwd: tempRoot,
        execPath: 'node',
        spawn,
      }),
    ).toBe(0);

    expect(spawn).toHaveBeenCalledWith(
      'node',
      [cli, 'generate', '--schema', schema],
      { cwd: root, stdio: 'inherit', env },
    );
  });

  test('propagates Prisma generation failure exit codes', () => {
    const root = path.join(tempRoot, 'repository');
    createPrismaProject(root);

    expect(
      generatePrisma({
        env: { npm_package_json: path.join(root, 'package.json') },
        scriptDir: path.join(root, 'scripts'),
        cwd: tempRoot,
        spawn: () => ({ status: 1 }),
      }),
    ).toBe(1);
  });
});
