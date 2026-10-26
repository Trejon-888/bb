import { beforeEach, expect, it, vi } from "vitest";
import type { AlertButton, AlertOptions } from "react-native";

const native = vi.hoisted(() => ({
  alert:
    vi.fn<
      (
        title: string,
        message: string,
        buttons: AlertButton[],
        options: AlertOptions,
      ) => void
    >(),
  open: vi.fn(),
  storage: new Map<string, string>(),
}));

vi.mock("react-native", () => ({
  Alert: { alert: native.alert },
  Linking: { openURL: native.open },
}));

vi.mock("@/lib/native/preferences-storage", () => ({
  getPreferencesStorage: () => ({
    getString: (key: string) => native.storage.get(key),
    set: (key: string, value: string) => native.storage.set(key, value),
  }),
}));

import {
  applicationLinkApprovals,
  openApplicationUrl,
} from "./application-url";

beforeEach(() => {
  native.storage.clear();
  native.alert.mockReset();
  native.open.mockReset().mockResolvedValue(undefined);
});

it("settles native dismissal and cancellation without launching, then allows a confirmed retry", async () => {
  native.alert.mockImplementationOnce((_title, _message, _buttons, options) =>
    options.onDismiss?.(),
  );
  await openApplicationUrl("things:///show?id=abc");
  native.alert.mockImplementationOnce((_title, _message, buttons) =>
    buttons.find((button) => button.style === "cancel")?.onPress?.(),
  );
  await openApplicationUrl("things:///show?id=abc");
  expect(native.open).not.toHaveBeenCalled();
  native.alert.mockImplementation((_title, _message, buttons) =>
    buttons.find((button) => button.text === "Open")?.onPress?.(),
  );
  native.open.mockRejectedValueOnce(new Error("App not installed"));
  await expect(openApplicationUrl("things:///show?id=abc")).rejects.toThrow(
    "App not installed",
  );
  await openApplicationUrl("reflect://note/Project%20X");
  expect(native.alert).toHaveBeenCalledTimes(4);
  expect(native.open).toHaveBeenLastCalledWith("reflect://note/Project%20X");
});

it("saves the native Always allow action and asks again after device reset", async () => {
  native.alert.mockImplementation((_title, _message, buttons) =>
    buttons
      .find((button) => button.text === "Always allow on this device")
      ?.onPress?.(),
  );
  await openApplicationUrl("reflect://note/one");
  await openApplicationUrl("reflect://note/two");
  expect(native.alert).toHaveBeenCalledOnce();
  expect(native.open).toHaveBeenCalledTimes(2);
  applicationLinkApprovals.revoke(null);
  await openApplicationUrl("reflect://note/three");
  expect(native.alert).toHaveBeenCalledTimes(2);
});
