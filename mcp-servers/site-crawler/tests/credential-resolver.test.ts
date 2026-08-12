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

function withTempManifest(extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "site-crawler-test-"));
  const manifestPath = join(dir, "profiles.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      [TEST_PROFILE]: {
        vaultRef: "<vault-path>",
        allowedDomains: [TEST_DOMAIN],
        ...extra,
      },
    })
  );
  return manifestPath;
}

test("resolveProfile returns redacted credentials on success", async () => {
  process.env.MCP_SECRETS_BACKEND = "local";
  process.env.MCP_PROFILES_PATH = withTempManifest();
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHUSER = "<BASIC_AUTH_USER>";
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHPASSWORD = "<BASIC_AUTH_PASSWORD>";

  const { resolveProfile } = await import("../src/auth/credential-resolver.js");
  const creds = await resolveProfile(TEST_PROFILE, TEST_DOMAIN);

  assert.equal(creds.profileName, TEST_PROFILE);
  assert.ok(creds.toString().includes("redacted"));
  assert.ok(!creds.toString().includes("<BASIC_AUTH_PASSWORD>"));
});

test("resolveProfile throws for unknown profile", async () => {
  process.env.MCP_SECRETS_BACKEND = "local";
  process.env.MCP_PROFILES_PATH = withTempManifest();
  const { resolveProfile, ProfileNotFoundError } = await import("../src/auth/credential-resolver.js");
  await assert.rejects(() => resolveProfile("does_not_exist", TEST_DOMAIN), ProfileNotFoundError);
});

test("resolveProfile throws for disallowed domain", async () => {
  process.env.MCP_SECRETS_BACKEND = "local";
  process.env.MCP_PROFILES_PATH = withTempManifest();
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHUSER = "<BASIC_AUTH_USER>";
  process.env.SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHPASSWORD = "<BASIC_AUTH_PASSWORD>";

  const { resolveProfile, DomainNotAllowedError } = await import("../src/auth/credential-resolver.js");
  await assert.rejects(() => resolveProfile(TEST_PROFILE, "not-allowed.test"), DomainNotAllowedError);
});

test("resolveProfile (doppler) throws when DOPPLER_TOKEN is missing", async () => {
  process.env.MCP_SECRETS_BACKEND = "doppler";
  delete process.env.DOPPLER_TOKEN;
  process.env.MCP_PROFILES_PATH = withTempManifest({
    dopplerConfig: { project: "bount-mcp-builder", config: "dev" },
  });

  const { resolveProfile, SecretBackendError } = await import("../src/auth/credential-resolver.js");
  await assert.rejects(() => resolveProfile(TEST_PROFILE, TEST_DOMAIN), SecretBackendError);
  process.env.MCP_SECRETS_BACKEND = "local";
});

test("resolveProfile (doppler) throws when profile has no dopplerConfig", async () => {
  process.env.MCP_SECRETS_BACKEND = "doppler";
  process.env.DOPPLER_TOKEN = "<DOPPLER_TOKEN>";
  process.env.MCP_PROFILES_PATH = withTempManifest();

  const { resolveProfile, SecretBackendError } = await import("../src/auth/credential-resolver.js");
  await assert.rejects(() => resolveProfile(TEST_PROFILE, TEST_DOMAIN), SecretBackendError);
  process.env.MCP_SECRETS_BACKEND = "local";
  delete process.env.DOPPLER_TOKEN;
});

test("resolveProfile (doppler) returns redacted credentials on success, never calling a real network", async () => {
  process.env.MCP_SECRETS_BACKEND = "doppler";
  process.env.DOPPLER_TOKEN = "<DOPPLER_TOKEN>";
  process.env.MCP_PROFILES_PATH = withTempManifest({
    dopplerConfig: { project: "bount-mcp-builder", config: "dev" },
  });

  const originalFetch = globalThis.fetch;
  let requestedUrl: string | undefined;
  globalThis.fetch = (async (url: string | URL) => {
    requestedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHUSER: "<BASIC_AUTH_USER>",
        SITE_CRAWLER_PROFILE_TEST_PROFILE_BASICAUTHPASSWORD: "<BASIC_AUTH_PASSWORD>",
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const { resolveProfile } = await import("../src/auth/credential-resolver.js");
    const creds = await resolveProfile(TEST_PROFILE, TEST_DOMAIN);

    assert.equal(creds.profileName, TEST_PROFILE);
    assert.ok(!creds.toString().includes("<BASIC_AUTH_PASSWORD>"));
    assert.ok(requestedUrl?.includes("project=bount-mcp-builder"));
    assert.ok(requestedUrl?.includes("config=dev"));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.MCP_SECRETS_BACKEND = "local";
    delete process.env.DOPPLER_TOKEN;
  }
});
