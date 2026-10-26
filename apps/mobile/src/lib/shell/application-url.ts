import {
  createApplicationLinkApprovals,
  APPLICATION_LINK_APPROVALS_STORAGE_KEY,
} from "@bb/domain/application-link-approvals";
import { getPreferencesStorage } from "@/lib/native/preferences-storage";
import {
  createApplicationUrlOpener,
  type ApplicationUrlDecision,
} from "@bb/domain/application-url";
import { Alert, Linking } from "react-native";

export const applicationLinkApprovals = createApplicationLinkApprovals({
  read: () =>
    getPreferencesStorage().getString(APPLICATION_LINK_APPROVALS_STORAGE_KEY) ??
    null,
  write: (value) =>
    getPreferencesStorage().set(APPLICATION_LINK_APPROVALS_STORAGE_KEY, value),
});

export const openApplicationUrl = createApplicationUrlOpener({
  approvals: applicationLinkApprovals,
  confirm: ({ scheme, url }) =>
    new Promise<ApplicationUrlDecision>((resolve) => {
      Alert.alert(
        `Open this ${scheme} link?`,
        `This will open an application on this device.\n\n${url}`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
          { text: "Open", onPress: () => resolve("open") },
          {
            text: "Always allow on this device",
            onPress: () => resolve("always"),
          },
        ],
        { cancelable: true, onDismiss: () => resolve("cancel") },
      );
    }),
  open: (url) => Linking.openURL(url),
});
