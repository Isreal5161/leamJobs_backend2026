async function verifyPrisma({
  loadPrismaClient = () => require("@prisma/client").PrismaClient,
  log = console.log,
  logError = console.error,
} = {}) {
  try {
    const PrismaClient = loadPrismaClient();

    if (typeof PrismaClient !== "function") {
      throw new Error("PrismaClient export is unavailable");
    }

    const client = new PrismaClient();
    await client.$disconnect();
    log("Prisma Client initialized and disconnected successfully.");
    log("Database connectivity was not tested.");
    return true;
  } catch {
    logError("Prisma Client verification failed during initialization or disconnection.");
    return false;
  }
}

if (require.main === module) {
  verifyPrisma().then((success) => {
    process.exitCode = success ? 0 : 1;
  }).catch(() => {
    console.error("Prisma Client verification failed.");
    process.exitCode = 1;
  });
}

module.exports = { verifyPrisma };
