import { createRequire } from "node:module";
import { jest } from "@jest/globals";

const require = createRequire(import.meta.url);
const { runPreflight } = require("../scripts/deploy-preflight.cjs");
const { verifyPrisma } = require("../scripts/verify-prisma.cjs");

describe("Prisma deployment preflight", () => {
  test("runs generation before verification and succeeds only when both pass", () => {
    const spawn = jest.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });
    const log = jest.fn();

    expect(runPreflight({
      root: "C:\\backend",
      execPath: "node",
      env: { SAFE_TEST_ENV: "1" },
      spawn,
      log,
    })).toBe(0);

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "node",
      ["C:\\backend\\scripts\\generate-prisma.cjs"],
      { cwd: "C:\\backend", env: { SAFE_TEST_ENV: "1" }, stdio: "inherit" },
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "node",
      ["C:\\backend\\scripts\\verify-prisma.cjs"],
      { cwd: "C:\\backend", env: { SAFE_TEST_ENV: "1" }, stdio: "inherit" },
    );
  });

  test("does not run verification when generation fails", () => {
    const spawn = jest.fn().mockReturnValue({ status: 1 });

    expect(() => runPreflight({
      root: "C:\\backend",
      spawn,
      log: jest.fn(),
    })).toThrow(/generation.*status 1.*stopped/i);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["generation", 1, { status: null, error: new Error("launch failure") }, /generation could not be started/i],
    ["verification", 2, { status: null, error: new Error("launch failure") }, /verification could not be started/i],
  ])("stops if spawning %s fails", (_step, count, spawnResult, message) => {
    const spawn = count === 1
      ? jest.fn().mockReturnValueOnce(spawnResult)
      : jest.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce(spawnResult);
    const log = jest.fn();

    expect(() => runPreflight({
      root: "C:\\backend",
      spawn,
      log,
    })).toThrow(message);

    expect(spawn).toHaveBeenCalledTimes(count);
    expect(log).not.toHaveBeenCalledWith(
      "[deploy:preflight] Prisma generation and initialization checks passed.",
    );
  });

  test.each([
    ["generation", 1, { status: null, signal: "SIGTERM" }, /generation was terminated by SIGTERM/i],
    ["verification", 2, { status: null, signal: "SIGTERM" }, /verification was terminated by SIGTERM/i],
  ])("stops if %s is terminated by a signal", (_step, count, spawnResult, message) => {
    const spawn = count === 1
      ? jest.fn().mockReturnValueOnce(spawnResult)
      : jest.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce(spawnResult);
    const log = jest.fn();

    expect(() => runPreflight({
      root: "C:\\backend",
      spawn,
      log,
    })).toThrow(message);

    expect(spawn).toHaveBeenCalledTimes(count);
    expect(log).not.toHaveBeenCalledWith(
      "[deploy:preflight] Prisma generation and initialization checks passed.",
    );
  });

  test("stops if the process launcher throws synchronously", () => {
    const spawn = jest.fn(() => {
      throw new Error("private launcher detail");
    });

    expect(() => runPreflight({
      root: "C:\\backend",
      spawn,
      log: jest.fn(),
    })).toThrow(/generation could not be started/i);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("does not report success when initialization verification fails", () => {
    const spawn = jest.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 2 });
    const log = jest.fn();

    expect(() => runPreflight({
      root: "C:\\backend",
      spawn,
      log,
    })).toThrow(/verification.*status 2.*stopped/i);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalledWith(
      "[deploy:preflight] Prisma generation and initialization checks passed.",
    );
  });

  test("instantiates and disconnects without claiming database connectivity", async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();
    const logError = jest.fn();
    const PrismaClient = jest.fn(() => ({ $disconnect: disconnect }));

    await expect(verifyPrisma({
      loadPrismaClient: () => PrismaClient,
      log,
      logError,
    })).resolves.toBe(true);

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Prisma Client initialized and disconnected successfully.",
    );
    expect(log).toHaveBeenCalledWith("Database connectivity was not tested.");
    expect(logError).not.toHaveBeenCalled();
  });

  test("returns failure and reports a safe message if Prisma initialization fails", async () => {
    const logError = jest.fn();
    const PrismaClient = jest.fn(() => {
      throw new Error("sensitive test detail should not be logged");
    });

    await expect(verifyPrisma({
      loadPrismaClient: () => PrismaClient,
      log: jest.fn(),
      logError,
    })).resolves.toBe(false);

    expect(PrismaClient).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Prisma Client verification failed during initialization or disconnection.",
    );
    expect(logError.mock.calls.flat().join(" ")).not.toContain("sensitive test detail");
  });

  test("returns failure if clean disconnection fails", async () => {
    const log = jest.fn();
    const logError = jest.fn();
    const PrismaClient = jest.fn(() => ({
      $disconnect: jest.fn().mockRejectedValue(new Error("disconnect failure")),
    }));

    await expect(verifyPrisma({
      loadPrismaClient: () => PrismaClient,
      log,
      logError,
    })).resolves.toBe(false);

    expect(log).not.toHaveBeenCalledWith(
      "Prisma Client initialized and disconnected successfully.",
    );
    expect(logError).toHaveBeenCalled();
  });
});
