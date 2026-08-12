import { test } from "node:test";
import assert from "node:assert/strict";
import { withAudit, getAuditLog } from "../src/audit-log.js";

test("withAudit records a success entry without leaking secret-shaped args", async () => {
  const before = getAuditLog().length;
  const result = await withAudit(
    { caller: "test", server: "aep-core", tool: "list_segments", profile: "cit_bank_test_user", domain: "citbank.com" },
    async () => "ok"
  );
  assert.equal(result, "ok");
  const after = getAuditLog();
  assert.equal(after.length, before + 1);
  const entry = after[after.length - 1];
  assert.equal(entry.outcome, "success");
  assert.equal(entry.profile, "cit_bank_test_user");
  assert.ok(!("access_token" in entry));
  assert.ok(!("client_secret" in entry));
});

test("withAudit records an error entry and rethrows", async () => {
  await assert.rejects(
    withAudit({ caller: "test", server: "site-crawler", tool: "crawl" }, async () => {
      throw new Error("boom");
    }),
    /boom/
  );
  const entries = getAuditLog();
  const last = entries[entries.length - 1];
  assert.equal(last.outcome, "error");
  assert.equal(last.errorMessage, "boom");
});
