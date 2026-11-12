const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runPreflight({
  root = path.resolve(__dirname, ".."),
  execPath = process.execPath,
  env = process.env,
  spawn = spawnSync,
  log = console.log,
} = {}) {
  const steps = [
    ["Prisma Client generation", "generate-prisma.cjs"],
    ["Prisma Client verification", "verify-prisma.cjs"],
  ];

  for (const [label, script] of steps) {
    const scriptPath = path.join(root, "scripts", script);
    log(`[deploy:preflight] Running ${label}...`);

    let result;
    try {
      result = spawn(execPath, [scriptPath], {
        cwd: root,
        env,
        stdio: "inherit",
      });
    } catch {
      throw new Error(`${label} could not be started; deployment preflight stopped.`);
    }

    if (!result || result.error || result.signal || result.status !== 0) {
      const reason = !result || result.error
        ? "could not be started"
        : result.signal ? `was terminated by ${result.signal}` : `exited with status ${result.status}`;
      throw new Error(`${label} ${reason}; deployment preflight stopped.`);
    }
  }

  log("[deploy:preflight] Prisma generation and initialization checks passed.");
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runPreflight();
  } catch (error) {
    console.error(`[deploy:preflight] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runPreflight };
