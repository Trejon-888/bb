import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  confirm: vi.fn(),
  open: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    destroyed = false;
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  },
  dialog: { showMessageBox: native.confirm },
  shell: { openExternal: native.open },
}));

import { BrowserWindow } from "electron";
import { openApplicationUrl } from "../src/application-url.js";

beforeEach(() => {
  native.confirm.mockReset();
  native.open.mockReset().mockResolvedValue(undefined);
});

it("attaches consent to the requesting window on every attempt and returns OS errors", async () => {
  const owner = new BrowserWindow();
  native.confirm.mockResolvedValue({ response: 0 });
  await openApplicationUrl(owner, "reflect://note/Project%20X");
  expect(native.open).not.toHaveBeenCalled();
  native.confirm.mockResolvedValue({ response: 1 });
  native.open.mockRejectedValueOnce(
    new Error("No application handles this URL"),
  );
  await expect(
    openApplicationUrl(owner, "reflect://note/Project%20X"),
  ).rejects.toThrow("No application");
  await openApplicationUrl(owner, "reflect://note/Another%20note");
  expect(native.confirm).toHaveBeenCalledTimes(3);
  expect(native.confirm).toHaveBeenLastCalledWith(
    owner,
    expect.objectContaining({ buttons: ["Cancel", "Open"], cancelId: 0 }),
  );
  expect(native.open).toHaveBeenLastCalledWith("reflect://note/Another%20note");
});

it("does not stack sheets on one window or launch after that window closes", async () => {
  const owner = new BrowserWindow();
  let decide: (value: { response: number }) => void = () => {};
  native.confirm.mockImplementation(
    () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  );
  const first = openApplicationUrl(owner, "linear://issue/123");
  await openApplicationUrl(owner, "reflect://note/test");
  expect(native.confirm).toHaveBeenCalledOnce();
  owner.destroy();
  decide({ response: 1 });
  await first;
  expect(native.open).not.toHaveBeenCalled();
});
