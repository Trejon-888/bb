import { useSyncExternalStore } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getApplicationUrlConfirmation,
  resolveApplicationUrlConfirmation,
  subscribeApplicationUrlConfirmation,
} from "@/lib/application-url";

export function ApplicationUrlDialogView() {
  const confirmation = useSyncExternalStore(
    subscribeApplicationUrlConfirmation,
    getApplicationUrlConfirmation,
  );
  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) resolveApplicationUrlConfirmation("cancel");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Open this {confirmation?.target.scheme} link?
          </DialogTitle>
          <DialogDescription>
            This will ask your browser to open an application on this device.
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm select-text">
          {confirmation?.target.url}
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              resolveApplicationUrlConfirmation("cancel");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              resolveApplicationUrlConfirmation("open");
            }}
          >
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
