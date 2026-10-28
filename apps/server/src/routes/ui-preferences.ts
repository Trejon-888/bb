import {
  isUiPreferenceKey,
  parseUiPreferenceValue,
  UI_PREFERENCE_KEYS,
  type UiPreferenceKey,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  readUiPreferences,
  resetUiPreference,
  writeUiPreference,
} from "../services/system/ui-preferences.js";
import type { AppDeps } from "../types.js";
import { overlayIxDeskPreferences, resetIxDeskPreference, writeIxDeskPreference } from "../ix/desk.js";

function requireUiPreferenceKey(key: string): UiPreferenceKey {
  if (isUiPreferenceKey(key)) return key;
  throw new ApiError(
    404,
    "ui_preference_not_found",
    `Unknown UI preference '${key}'. Known preferences: ${UI_PREFERENCE_KEYS.join(", ")}.`,
  );
}

export function registerUiPreferenceRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, put } = typedRoutes<PublicApiSchema>(app, {
    invalidateTags: (tags) => deps.hub.notifyTags(tags),
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.system;

  get(routes.uiPreferences, (context) =>
    context.json({ preferences: overlayIxDeskPreferences(deps.ixAuth.desk, readUiPreferences(deps)) }),
  );

  put(routes.updateUiPreference, (context, payload) => {
    const key = requireUiPreferenceKey(context.req.param("key"));
    const parsed = parseUiPreferenceValue(key, payload.value);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        `Invalid value for UI preference '${key}': ${parsed.message}`,
      );
    }
    const args = { expectedRevision: payload.expectedRevision, key, value: parsed.value };
    const result = writeIxDeskPreference(deps.ixAuth.desk, args) ?? writeUiPreference(deps, args);
    if (result.outcome === "conflict") {
      throw new ApiError(
        409,
        "ui_preference_conflict",
        "UI preference changed on another client",
        { details: { currentRevision: result.revision } },
      );
    }
    return context.json({ key, ...result.entry });
  });

  del(routes.resetUiPreference, (context) => {
    const key = requireUiPreferenceKey(context.req.param("key"));
    const personal = resetIxDeskPreference(deps.ixAuth.desk, key, () => readUiPreferences(deps)[key]);
    return context.json({ key, ...(personal ?? resetUiPreference(deps, key)) });
  });
}
