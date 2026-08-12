/**
 * Tests for auth/credential-resolver.ts. Uses only synthetic placeholder
 * values written to a temp profiles.json + temp env vars — no real
 * secrets anywhere in this file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MCP_SECRETS_BACKEND = "local";

const TEST_PROFILE = "test_profile";
const TEST_DOMAIN = "example.test";

function withTempManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "site-crawler-test-"));
  const manifestPath = join(dir, "profiles.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      [TEST_PROFILE]: {
        vaultRef: "<vault-path>",
        allowedDomains: [TEST_DOMAIN],
      },
    })
  );
  return manifestPath;
}

test("resolveProfile returns redacted credentials on success", async () => {
  process.env.MCP_PROFILES_PATH = withTempManifest();
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHUSER = "<BASIC_AUTH_USER>";
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHPASSWORD = "<BASIC_AUTH_PASSWORD>";

  const { resolveProfile } = await import("../src/auth/credential-resolver.js");
  const creds = resolveProfile(TEST_PROFILE, TEST_DOMAIN);

  assert.equal(creds.profileName, TEST_PROFILE);
  assert.ok(creds.toString().includes("redacted"));
  assert.ok(!creds.toString().includes("<BASIC_AUTH_PASSWORD>"));
});

test("resolveProfile throws for unknown profile", async () => {
  process.env.MCP_PROFILES_PATH = withTempManifest();
  const { resolveProfile, ProfileNotFoundError } = await import("../src/auth/credential-resolver.js");
  assert.throws(() => resolveProfile("does_not_exist", TEST_DOMAIN), ProfileNotFoundError);
});

test("resolveProfile throws for disallowed domain", async () => {
  process.env.MCP_PROFILES_PATH = withTempManifest();
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHUSER = "<BASIC_AUTH_USER>";
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHPASSWORD = "<BASIC_AUTH_PASSWORD>";

  const { resolveProfile, DomainNotAllowedError } = await import("../src/auth/credential-resolver.js");
  assert.throws(() => resolveProfile(TEST_PROFILE, "not-allowed.test"), DomainNotAllowedError);
});
