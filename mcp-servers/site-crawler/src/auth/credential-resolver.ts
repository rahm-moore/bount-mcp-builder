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

interface DopplerConfigRef {
  project: string;
  config: string;
}

interface ProfileMetadata {
  vaultRef?: string;
  dopplerConfig?: DopplerConfigRef;
  allowedDomains: string[];
}

type ProfilesManifest = Record<string, ProfileMetadata>;

const DOPPLER_API_BASE = "https://api.doppler.com/v3";

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
        `Set them, or switch MCP_SECRETS_BACKEND=doppler (see docs/security-model.md).`
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
 * Fetch the full secrets map for one Doppler project/config. Isolated as
 * its own function so tests can stub `globalThis.fetch` instead of
 * hitting the real Doppler API.
 */
async function fetchDopplerSecrets(project: string, config: string, token: string): Promise<Record<string, string>> {
  const url = new URL(`${DOPPLER_API_BASE}/configs/config/secrets/download`);
  url.searchParams.set("project", project);
  url.searchParams.set("config", config);
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url, {
      // Doppler API: bearer token as basic-auth username, empty password.
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
    });
  } catch (err) {
    throw new SecretBackendError(
      `Doppler request failed for project=${project} config=${config}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new SecretBackendError(
      `Doppler request failed for project=${project} config=${config}: HTTP ${response.status}`
    );
  }
  return (await response.json()) as Record<string, string>;
}

async function resolveDoppler(profileName: string, meta: ProfileMetadata): Promise<ResolvedCredentials> {
  const dopplerConfig = meta.dopplerConfig;
  if (!dopplerConfig?.project || !dopplerConfig?.config) {
    throw new SecretBackendError(`Profile '${profileName}' has no dopplerConfig (project/config) configured.`);
  }

  const token = process.env.DOPPLER_TOKEN;
  if (!token) {
    throw new SecretBackendError(
      "DOPPLER_TOKEN is not set. This is the one bootstrap credential this process needs — " +
        "a Doppler service token scoped to the project/config referenced by each profile's " +
        "dopplerConfig. See docs/security-model.md."
    );
  }

  const secretsMap = await fetchDopplerSecrets(dopplerConfig.project, dopplerConfig.config, token);

  const requiredFields = ["basicAuthUser", "basicAuthPassword"];
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of requiredFields) {
    const secretName = envVarFor(profileName, field);
    const value = secretsMap[secretName];
    if (!value) {
      missing.push(secretName);
      continue;
    }
    values[field] = value;
  }

  if (missing.length > 0) {
    throw new SecretBackendError(
      `Missing Doppler secrets for profile '${profileName}' in ` +
        `${dopplerConfig.project}/${dopplerConfig.config}: ${missing.join(", ")}.`
    );
  }

  return redactedCreds(profileName, values);
}

/**
 * Resolve a profile name + target domain into usable credentials for the
 * site crawler (e.g. HTTP basic auth for a staging environment gated
 * behind auth). Validates `domain` against the profile's `allowedDomains`
 * so a credential can't be replayed against an unintended target.
 */
export async function resolveProfile(profileName: string, domain: string): Promise<ResolvedCredentials> {
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
  if (backend === "doppler") return resolveDoppler(profileName, meta);

  throw new SecretBackendError(`Unknown MCP_SECRETS_BACKEND: ${backend}`);
}
