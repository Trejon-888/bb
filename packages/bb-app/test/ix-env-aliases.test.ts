import { describe, expect, it } from "vitest";
import { productCliName } from "@bb/config/product-name";
import { applyIxEnvAliases } from "../src/ix-env-aliases.js";

describe("applyIxEnvAliases", () => {
  it("copies IX_* into BB_* only when BB_* is absent", () => {
    const env = applyIxEnvAliases(
      { IX_SERVER_PORT: "4000", IX_LOG_LEVEL: "debug", BB_LOG_LEVEL: "info" },
      "/usr/local/bin/bb",
    );
    expect(env.BB_SERVER_PORT).toBe("4000");
    expect(env.BB_LOG_LEVEL).toBe("info");
    expect(env.BB_IX_PRODUCT_CLI).toBeUndefined();
  });

  it("lets IX_DATA_DIR win over BB_DATA_DIR", () => {
    const env = applyIxEnvAliases(
      { IX_DATA_DIR: "/tmp/ix-data", BB_DATA_DIR: "/tmp/bb-data" },
      "/usr/local/bin/bb",
    );
    expect(env.BB_DATA_DIR).toBe("/tmp/ix-data");
  });

  it("marks the product CLI as ix when invoked through an ix bin", () => {
    const env = applyIxEnvAliases({}, "/opt/pkg/dist/ix.js");
    expect(env.BB_IX_PRODUCT_CLI).toBe("ix");
    expect(productCliName({ env, scriptPath: "/opt/pkg/dist/bb.js" })).toBe(
      "ix",
    );
  });

  it("keeps an explicit product CLI setting", () => {
    const env = applyIxEnvAliases(
      { BB_IX_PRODUCT_CLI: "bb" },
      "/opt/pkg/dist/ix-app.js",
    );
    expect(env.BB_IX_PRODUCT_CLI).toBe("bb");
    expect(productCliName({ env, scriptPath: "/opt/pkg/dist/ix.js" })).toBe(
      "bb",
    );
  });
});

describe("productCliName", () => {
  it("defaults to bb", () => {
    expect(productCliName({ env: {}, scriptPath: "/opt/pkg/dist/bb.js" })).toBe(
      "bb",
    );
    expect(productCliName({ env: {}, scriptPath: undefined })).toBe("bb");
  });

  it("reads ix from the invoked script basename", () => {
    expect(productCliName({ env: {}, scriptPath: "/x/ix" })).toBe("ix");
    expect(productCliName({ env: {}, scriptPath: "C:\\x\\ix-app.js" })).toBe(
      "ix",
    );
  });
});
