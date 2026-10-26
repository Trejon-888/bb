import { EventEmitter } from "node:events";
import {
  WorkspaceError,
  inspectGitRepository,
} from "bb-environment-provider-host/git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../src/git.js";

const execPortableFileMock = vi.hoisted(() => vi.fn());
const spawnPortableOutputProcessMock = vi.hoisted(() => vi.fn());

vi.mock("@bb/process-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/process-utils")>();
  return {
    ...actual,
    execPortableFile: execPortableFileMock,
    spawnPortableOutputProcess: spawnPortableOutputProcessMock,
  };
});

const STATUS_DLL_INIT_FAILED = 0xc0000142;
const STATUS_ACCESS_VIOLATION = 0xc0000005;

function processFailure(
  overrides: Partial<{
    code: number | string;
    signal: string | null;
    killed: boolean;
    stdout: string;
    stderr: string;
  }> = {},
): Error {
  return Object.assign(new Error("Command failed: git"), {
    code: 1,
    signal: null,
    killed: false,
    stdout: "",
    stderr: "",
    ...overrides,
  });
}

function exitedProcess(exitCode: number, stdout = ""): EventEmitter {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", exitCode);
  });
  return child;
}

afterEach(() => {
  execPortableFileMock.mockReset();
  spawnPortableOutputProcessMock.mockReset();
});

describe("runGit Windows startup crash retries", () => {
  it("retries a silent Windows process startup crash", async () => {
    execPortableFileMock
      .mockRejectedValueOnce(processFailure({ code: STATUS_DLL_INIT_FAILED }))
      .mockResolvedValueOnce({ stdout: "ok\n", stderr: "" });

    const result = await runGit(["status"], { cwd: "/repo" });

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(execPortableFileMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a Windows crash after the process started", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_ACCESS_VIOLATION }),
    );

    await expect(runGit(["commit"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure that produced output", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ stderr: "fatal: bad revision\n" }),
    );

    await expect(runGit(["diff", "bad"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a plain silent nonzero exit", async () => {
    execPortableFileMock.mockRejectedValue(processFailure());

    await expect(runGit(["merge-base"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded attempts and reports the failure", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_DLL_INIT_FAILED }),
    );

    await expect(runGit(["fetch"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(3);
  });

  it("returns the crash exit code to allowFailure callers only after retrying", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_DLL_INIT_FAILED }),
    );

    const result = await runGit(["show-ref"], {
      cwd: "/repo",
      allowFailure: true,
    });

    expect(result.exitCode).toBe(STATUS_DLL_INIT_FAILED);
    expect(execPortableFileMock).toHaveBeenCalledTimes(3);
  });
});

describe("shared git runner Windows startup crash retries", () => {
  it("does not mistake a silent startup crash for a non-Git folder", async () => {
    spawnPortableOutputProcessMock
      .mockImplementationOnce(() => exitedProcess(STATUS_DLL_INIT_FAILED))
      .mockImplementationOnce(() =>
        exitedProcess(0, `true\nfalse\n${process.cwd()}\n${process.cwd()}\n`),
      );

    await expect(inspectGitRepository(process.cwd())).resolves.toEqual({
      isGitRepo: true,
      isWorktree: false,
    });
    expect(spawnPortableOutputProcessMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after bounded attempts", async () => {
    spawnPortableOutputProcessMock.mockImplementation(() =>
      exitedProcess(STATUS_DLL_INIT_FAILED),
    );

    await expect(inspectGitRepository(process.cwd())).resolves.toEqual({
      isGitRepo: false,
      isWorktree: false,
    });
    expect(spawnPortableOutputProcessMock).toHaveBeenCalledTimes(3);
  });
});
