import { createApplicationUrlOpener } from "@bb/domain/application-url";
import { dialog, shell, type BrowserWindow } from "electron";

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
      confirm: async ({ scheme, url }) => {
        const result = await dialog.showMessageBox(owner, {
          type: "question",
          title: "Open another app",
          message: `Open this ${scheme} link?`,
          detail: `This will open an application on this device.\n\n${url}`,
          buttons: ["Cancel", "Open"],
          defaultId: 0,
          cancelId: 0,
        });
        return result.response === 1 && !owner.isDestroyed()
          ? "open"
          : "cancel";
      },
      open: (url) => shell.openExternal(url),
    });
    windowOpeners.set(owner, open);
  }
  return open(value);
}
