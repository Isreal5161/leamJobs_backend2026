const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function resolveRepositoryRoot({
  env = process.env,
  scriptDir = __dirname,
  cwd = process.cwd(),
  existsSync = fs.existsSync,
} = {}) {
  const candidates = [
    env.npm_package_json ? path.dirname(path.resolve(env.npm_package_json)) : null,
    path.resolve(scriptDir, ".."),
    env.INIT_CWD ? path.resolve(env.INIT_CWD) : null,
    path.resolve(cwd),
  ].filter(Boolean);
  const checked = [...new Set(candidates)];

  const root = checked.find((candidate) =>
    existsSync(path.join(candidate, "prisma", "schema.prisma")),
  );

  if (!root) {
    throw new Error(
      `Prisma schema not found. Checked: ${checked
        .map((candidate) => path.join(candidate, "prisma", "schema.prisma"))
        .join(", ")}`,
    );
  }

  return root;
}

function resolvePrismaCli(root, existsSync = fs.existsSync) {
  const cli = path.join(root, "node_modules", "prisma", "build", "index.js");

  if (!existsSync(cli)) {
    throw new Error(`Prisma CLI entry point not found: ${cli}`);
  }

  return cli;
}

function generatePrisma({
  env = process.env,
  scriptDir = __dirname,
  cwd = process.cwd(),
  execPath = process.execPath,
  spawn = spawnSync,
  existsSync = fs.existsSync,
} = {}) {
  const root = resolveRepositoryRoot({ env, scriptDir, cwd, existsSync });
  const schema = path.join(root, "prisma", "schema.prisma");
  const cli = resolvePrismaCli(root, existsSync);
  const result = spawn(execPath, [cli, "generate", "--schema", schema], {
    cwd: root,
    stdio: "inherit",
    env,
  });

  if (result.error) {
    throw new Error(`Unable to start Prisma Client generation: ${result.error.message}`);
  }

  if (result.status === null) {
    throw new Error(
      `Prisma Client generation did not exit normally${result.signal ? ` (signal ${result.signal})` : ""}`,
    );
  }

  return result.status;
}

if (require.main === module) {
  try {
    process.exitCode = generatePrisma();
  } catch (error) {
    console.error(`Prisma Client generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { generatePrisma, resolvePrismaCli, resolveRepositoryRoot };
