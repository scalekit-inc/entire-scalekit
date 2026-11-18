import { describe, expect, it } from "vitest";
import { looseModeWarning, scalekitConfig, setupMessage, unreadableMessage } from "../src/config.js";

const FULL = "SCALEKIT_ENV_URL=https://file.scalekit.cloud\nSCALEKIT_CLIENT_ID=file_id\nSCALEKIT_CLIENT_SECRET=file_secret\n";

describe("scalekitConfig", () => {
  it("reads the three values from the config file when the shell has none", () => {
    expect(scalekitConfig({}, FULL)).toEqual({
      values: { envUrl: "https://file.scalekit.cloud", clientId: "file_id", clientSecret: "file_secret" },
      missing: [],
      partialShell: [],
    });
  });

  it("uses the shell when it has all three values", () => {
    const shell = { SCALEKIT_ENV_URL: "https://shell.scalekit.cloud", SCALEKIT_CLIENT_ID: "shell_id", SCALEKIT_CLIENT_SECRET: "shell_secret" };
    expect(scalekitConfig(shell, FULL).values).toEqual({ envUrl: "https://shell.scalekit.cloud", clientId: "shell_id", clientSecret: "shell_secret" });
  });

  it("never mixes a partial shell with the file", () => {
    // A stale export of one value must not pair with the other environment's secret in the file.
    const { values } = scalekitConfig({ SCALEKIT_ENVIRONMENT_URL: "https://stale.scalekit.cloud", SCALEKIT_CLIENT_ID: "shell_id" }, FULL);
    expect(values).toEqual({ envUrl: "https://file.scalekit.cloud", clientId: "file_id", clientSecret: "file_secret" });
  });

  it("treats an empty shell value as unset", () => {
    expect(scalekitConfig({ SCALEKIT_ENV_URL: "", SCALEKIT_CLIENT_ID: "x", SCALEKIT_CLIENT_SECRET: "y" }, FULL).values?.clientId).toBe("file_id");
  });

  it("accepts SCALEKIT_ENVIRONMENT_URL as another name for SCALEKIT_ENV_URL", () => {
    const text = "SCALEKIT_ENVIRONMENT_URL=https://alias.scalekit.cloud\nSCALEKIT_CLIENT_ID=a\nSCALEKIT_CLIENT_SECRET=b\n";
    expect(scalekitConfig({}, text).values?.envUrl).toBe("https://alias.scalekit.cloud");
    expect(scalekitConfig({ SCALEKIT_ENVIRONMENT_URL: "https://shell.scalekit.cloud", SCALEKIT_CLIENT_ID: "a", SCALEKIT_CLIENT_SECRET: "b" }, undefined).values?.envUrl).toBe("https://shell.scalekit.cloud");
  });

  it("prefers SCALEKIT_ENV_URL when both names are set", () => {
    const text = "SCALEKIT_ENVIRONMENT_URL=https://alias.scalekit.cloud\nSCALEKIT_ENV_URL=https://main.scalekit.cloud\nSCALEKIT_CLIENT_ID=a\nSCALEKIT_CLIENT_SECRET=b\n";
    expect(scalekitConfig({}, text).values?.envUrl).toBe("https://main.scalekit.cloud");
  });

  it("names only what the file lacks", () => {
    expect(scalekitConfig({}, "SCALEKIT_ENV_URL=https://x.scalekit.cloud\n").missing).toEqual(["SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET"]);
  });

  it("names every missing variable and returns no values when there is no file", () => {
    expect(scalekitConfig({}, undefined)).toEqual({ values: undefined, missing: ["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID", "SCALEKIT_CLIENT_SECRET"], partialShell: [] });
  });

  it("reads quoted values, comments and other names in the file without complaint", () => {
    const text = '# Scalekit\nSCALEKIT_ENV_URL="https://q.scalekit.cloud"\nSCALEKIT_IDENTIFIER=old\nSCALEKIT_CLIENT_ID=a\nSCALEKIT_CLIENT_SECRET=\'b\'\n';
    expect(scalekitConfig({}, text).values).toEqual({ envUrl: "https://q.scalekit.cloud", clientId: "a", clientSecret: "b" });
  });
});

describe("setupMessage", () => {
  const msg = setupMessage(["SCALEKIT_CLIENT_SECRET"], "/data/scalekit/config.env");

  it("names the missing variable and the file to put it in", () => {
    expect(msg).toContain("has no Scalekit credentials");
    expect(msg).toContain("SCALEKIT_CLIENT_SECRET");
    expect(msg).toContain("/data/scalekit/config.env");
    expect(msg).toContain("install -m 600 .env '/data/scalekit/config.env'");
  });

  it("tells an agent to stop and not reach the app another way", () => {
    expect(msg).toMatch(/agent/i);
    expect(msg).toContain("Do not reach the app another way");
  });

  it("does not ask for an export in every terminal", () => {
    expect(msg).not.toContain("export ENTIRE_PLUGIN_ENV");
  });
});

describe("setup paths with spaces", () => {
  it("quotes the path in the printed commands", () => {
    expect(setupMessage(["SCALEKIT_CLIENT_ID"], "/Users/a b/Application Support/config.env")).toContain("install -m 600 .env '/Users/a b/Application Support/config.env'");
    expect(unreadableMessage("/x y/config.env", "EACCES")).toContain("chmod 600 '/x y/config.env'");
  });
});

describe("a partial export in the shell", () => {
  it("is reported, so the person knows why the export was ignored", () => {
    const { partialShell, missing } = scalekitConfig({ SCALEKIT_ENV_URL: "https://x.scalekit.cloud", SCALEKIT_CLIENT_ID: "id" }, undefined);
    expect(partialShell).toEqual(["SCALEKIT_ENV_URL", "SCALEKIT_CLIENT_ID"]);
    expect(setupMessage(missing, "/d/config.env", partialShell)).toContain("Your shell exports SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID but not all three, so those exports were not used.");
  });
  it("is not mentioned when the shell exports none", () => {
    expect(setupMessage(["SCALEKIT_CLIENT_ID"], "/d/config.env")).not.toContain("Your shell exports");
  });
});

describe("unreadableMessage", () => {
  it("tells an agent to stop", () => {
    expect(unreadableMessage("/d/config.env", "EACCES: permission denied")).toContain("Do not reach the app another way");
  });
});

describe("looseModeWarning", () => {
  it("warns when group or others can read the file", () => {
    expect(looseModeWarning("/d/config.env", 0o100644)).toContain("chmod 600");
    expect(looseModeWarning("/d/config.env", 0o100640)).toContain("chmod 600");
  });
  it("is quiet for a file only the owner can read", () => {
    expect(looseModeWarning("/d/config.env", 0o100600)).toBeUndefined();
  });
});
