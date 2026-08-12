/**
 * Profile-based credential resolution (TypeScript twin of
 * mcp-servers/aep-core/src/aep_core/auth/credential_resolver.py — see that
 * file for the full policy writeup; this keeps the same contract).
 *
 * MCP tools in this server accept a `profile` name string and a `domain`,
 * never raw secret values. `resolveProfile()` is the only function allowed
 * to turn a profile name into usable credentials, and the result must
 * never be returned from a tool's response payload, logged, or otherwise
 * exposed back to the calling model — it is for internal use (e.g.
 * authenticating a Playwright request) only.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export class ProfileNotFoundError extends Error {}
export class DomainNotAllowedError extends Error {}
export class SecretBackendError extends Error {}

export interface ResolvedCredentials {
  profileName: string;
  /** Redacted on purpose — never populate with a real secret in logs/toString. */
  toString(): string;
  [key: string]: unknown;
}

interface ProfileMetadata {
  vaultRef?: string;
  allowedDomains: string[];
}

type ProfilesManifest = Record<string, ProfileMetadata>;

function profilesManifestPath(): string {
  const override = process.env.MCP_PROFILES_PATH;
  if (override) return override;
  // repo-root/secrets/profiles.json relative to this file at runtime
  return resolve(__dirname, "..", "..", "..", "..", "secrets", "profiles.json");
}

function loadProfilesManifest(): ProfilesManifest {
  const path = profilesManifestPath();
  if (!existsSync(path)) {
    throw new SecretBackendError(
      `Profiles manifest not found at ${path}. Copy secrets/profiles.example.json ` +
        `to secrets/profiles.json and fill it in for local development.`
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as ProfilesManifest;
}

function envVarFor(profileName: string, field: string): string {
  const normalized = profileName.toUpperCase().replace(/-/g, "_");
  return `SITE_CRAWLER_PROFILE_${normalized}_${field.toUpperCase()}`;
}

function redactedCreds(profileName: string, fields: Record<string, string>): ResolvedCredentials {
  return {
    profileName,
    ...fields,
    toString: () => `ResolvedCredentials(profileName=${profileName}, <redacted>)`,
  };
}

function resolveLocal(profileName: string): ResolvedCredentials {
  const requiredFields = ["basicAuthUser", "basicAuthPassword"];
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of requiredFields) {
    const envName = envVarFor(profileName, field);
    const value = process.env[envName];
    if (!value) {
      missing.push(envName);
      continue;
    }
    values[field] = value;
  }

  if (missing.length > 0) {
    throw new SecretBackendError(
      `Missing local secret env vars for profile '${profileName}': ${missing.join(", ")}. ` +
        `Set them or switch MCP_SECRETS_BACKEND=vault.`
    );
  }

  return redactedCreds(profileName, values);
}

function resolveVault(profileName: string, meta: ProfileMetadata): ResolvedCredentials {
  if (!meta.vaultRef) {
    throw new SecretBackendError(`Profile '${profileName}' has no vaultRef configured.`);
  }
  throw new Error(
    `NotImplemented: wire up Vault/AWS Secrets Manager lookup for vaultRef=${meta.vaultRef} here`
  );
}

/**
 * Resolve a profile name + target domain into usable credentials for the
 * site crawler (e.g. HTTP basic auth for a staging environment gated
 * behind auth). Validates `domain` against the profile's `allowedDomains`
 * so a credential can't be replayed against an unintended target.
 */
export function resolveProfile(profileName: string, domain: string): ResolvedCredentials {
  const manifest = loadProfilesManifest();
  const meta = manifest[profileName];
  if (!meta) {
    throw new ProfileNotFoundError(`Unknown profile: ${profileName}`);
  }

  const allowedDomains = meta.allowedDomains ?? [];
  if (!allowedDomains.includes(domain) && !allowedDomains.includes("*")) {
    throw new DomainNotAllowedError(
      `Profile ${profileName} is not authorized for domain ${domain}. Allowed: ${allowedDomains.join(", ")}`
    );
  }

  const backend = (process.env.MCP_SECRETS_BACKEND ?? "local").toLowerCase();
  if (backend === "local") return resolveLocal(profileName);
  if (backend === "vault") return resolveVault(profileName, meta);

  throw new SecretBackendError(`Unknown MCP_SECRETS_BACKEND: ${backend}`);
}
