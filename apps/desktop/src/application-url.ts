import { createApplicationUrlOpener } from "@bb/domain/application-url";
import { app, dialog, shell, type BrowserWindow } from "electron";
import { createFileApplicationLinkApprovals } from "@bb/config/application-link-approvals";

export function desktopApplicationLinkApprovals() {
  return createFileApplicationLinkApprovals(app.getPath("userData"));
}

const windowOpeners = new WeakMap<
  BrowserWindow,
  ReturnType<typeof createApplicationUrlOpener>
>();

export function openApplicationUrl(
  owner: BrowserWindow,
  value: unknown,
): Promise<void> {
  let open = windowOpeners.get(owner);
  if (open === undefined) {
    open = createApplicationUrlOpener({
      approvals: desktopApplicationLinkApprovals(),
      confirm: async ({ scheme, url }) => {
        const result = await dialog.showMessageBox(owner, {
          type: "question",
          title: "Open another app",
          message: `Open this ${scheme} link?`,
          detail: `This will open an application on this device.\n\n${url}`,
          buttons: ["Cancel", "Open"],
          defaultId: 0,
          cancelId: 0,
          checkboxLabel: `Always allow ${scheme} links on this device`,
          checkboxChecked: false,
        });
        return result.response === 1 && !owner.isDestroyed()
          ? result.checkboxChecked
            ? "always"
            : "open"
          : "cancel";
      },
      open: (url) => shell.openExternal(url),
    });
    windowOpeners.set(owner, open);
  }
  return open(value);
}
