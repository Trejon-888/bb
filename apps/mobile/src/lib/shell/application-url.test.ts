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
}));

vi.mock("react-native", () => ({
  Alert: { alert: native.alert },
  Linking: { openURL: native.open },
}));

import { openApplicationUrl } from "./application-url";

beforeEach(() => {
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
