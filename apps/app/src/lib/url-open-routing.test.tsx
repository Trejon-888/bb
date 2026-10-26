// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultExperiments } from "@bb/domain";
import { appToast } from "@/components/ui/app-toast";
import { appQueryClient } from "./app-query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { useAppNavigationHost } from "./app-navigation-host";
import {
  AppNavigationUrlHost,
  openUrlInExternalBrowser,
} from "./url-open-routing";

const results: boolean[] = [];

function PluginLink() {
  const navigation = useAppNavigationHost();
  return (
    <button
      onClick={() =>
        results.push(navigation.openUrl({ url: "linear://issue/123" }))
      }
    >
      Open issue
    </button>
  );
}

afterEach(() => {
  cleanup();
  appQueryClient.removeQueries({ queryKey: systemConfigQueryKey() });
  results.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("gates plugin navigation and direct external opening as the experiment changes", () => {
  const openApplicationUrl = vi.fn(async () => {});
  vi.stubGlobal("bbDesktop", { openApplicationUrl });
  render(
    <AppNavigationUrlHost>
      <PluginLink />
    </AppNavigationUrlHost>,
  );
  fireEvent.click(screen.getByRole("button"));
  openUrlInExternalBrowser("linear://issue/123");
  expect(results).toEqual([false]);
  expect(openApplicationUrl).not.toHaveBeenCalled();
  act(() => {
    appQueryClient.setQueryData(systemConfigQueryKey(), {
      experiments: { ...defaultExperiments, applicationLinks: true },
    });
  });
  fireEvent.click(screen.getByRole("button"));
  expect(results).toEqual([false, true]);
  expect(openApplicationUrl).toHaveBeenCalledWith("linear://issue/123");
  act(() => {
    appQueryClient.setQueryData(systemConfigQueryKey(), {
      experiments: defaultExperiments,
    });
  });
  fireEvent.click(screen.getByRole("button"));
  openUrlInExternalBrowser("linear://issue/123");
  expect(results).toEqual([false, true, false]);
  expect(openApplicationUrl).toHaveBeenCalledOnce();
});

it("asks to update an older desktop client instead of falling back to browser navigation", async () => {
  appQueryClient.setQueryData(systemConfigQueryKey(), {
    experiments: { ...defaultExperiments, applicationLinks: true },
  });
  const external = vi.fn();
  vi.stubGlobal("bbDesktop", { openExternalUrl: external });
  const error = vi.spyOn(appToast, "error").mockImplementation(() => "toast");
  openUrlInExternalBrowser("linear://issue/123");
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith("Couldn't open application link", {
      description: "Update the BB desktop app to open application links.",
    }),
  );
  expect(external).not.toHaveBeenCalled();
});
