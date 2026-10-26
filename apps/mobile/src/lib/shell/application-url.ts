import {
  createApplicationUrlOpener,
  type ApplicationUrlDecision,
} from "@bb/domain/application-url";
import { Alert, Linking } from "react-native";

export const openApplicationUrl = createApplicationUrlOpener({
  confirm: ({ scheme, url }) =>
    new Promise<ApplicationUrlDecision>((resolve) => {
      Alert.alert(
        `Open this ${scheme} link?`,
        `This will open an application on this device.\n\n${url}`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
          { text: "Open", onPress: () => resolve("open") },
        ],
        { cancelable: true, onDismiss: () => resolve("cancel") },
      );
    }),
  open: (url) => Linking.openURL(url),
});
