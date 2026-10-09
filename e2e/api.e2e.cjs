/*
 * Browser + HTTP e2e for the public API (/api/v1), API keys and webhook management.
 * Run against `next dev` (see automation.e2e.cjs for the setup).
 */
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "API Test A.Ş.");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const api = (key, path, init = {}) =>
    fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  // ---- free plan has no API quota
  await page.goto(`${BASE}/settings/developers`);
  await page.getByText("planınız API erişimi içermiyor").waitFor();
  step("the free plan shows that API access is not included", true);

  // quota of exactly 6 requests for this test
  psql(
    `insert into entitlement_overrides (organization_id, entitlement_key, limit_value, reason) values ('${orgId}','api_requests',6,'e2e')`,
  );
  await page.reload();

  // ---- create keys in the UI; the secret is shown once
  async function createKey(name, scopeLabel) {
    await page.getByLabel("Ad", { exact: true }).fill(name);
    await page.getByLabel("Yetki").selectOption({ label: scopeLabel });
    await page.getByRole("button", { name: "Anahtar oluştur" }).click();
    const shown = page.getByTestId("shown-once");
    await shown.waitFor();
    const key = (await shown.innerText()).trim();
    await page.getByRole("button", { name: "Kopyaladım, kapat" }).click();
    return key;
  }
  const readKey = await createKey("Okuma anahtarı", "Okuma");
  const writeKey = await createKey("Yazma anahtarı", "Yazma");
  step(
    "keys have the documented format and are shown once",
    /^mlk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/.test(readKey) &&
      (await page.getByTestId("shown-once").count()) === 0,
  );
  step(
    "the database stores a hash, never the key",
    psql(`select count(*) from api_keys where organization_id='${orgId}'`) === "2" &&
      psql(
        `select count(*) from api_keys where secret_hash = '${readKey.split("_")[2]}'`,
      ) === "0",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/developers.png`, fullPage: true });

  // ---- authentication and scopes
  step("no key → 401", (await api(null, "/me")).status === 401);
  step("malformed key → 401", (await api("mlk_nope", "/me")).status === 401);
  step(
    "well-formed but wrong secret → 401",
    (await api(`mlk_${readKey.split("_")[1]}_${"a".repeat(43)}`, "/me")).status === 401,
  );
  const me = await api(readKey, "/me");
  const meBody = await me.json();
  step(
    "read key identifies its organization and scope",
    me.status === 200 && meBody.scope === "read" && meBody.organization.id === orgId,
  );
  step("responses are not cacheable", me.headers.get("cache-control") === "no-store");
  const denied = await api(readKey, "/contacts", {
    method: "POST",
    body: JSON.stringify({ email: "x@example.org" }),
  });
  step(
    "a read key cannot write (403 insufficient_scope)",
    denied.status === 403 && (await denied.json()).error.code === "insufficient_scope",
  );

  // ---- write key: create + read back through the public contract
  const created = await api(writeKey, "/contacts", {
    method: "POST",
    body: JSON.stringify({
      email: "Api.Kisi@Example.org",
      firstName: "Api",
      consentStatus: "granted",
    }),
  });
  const contact = await created.json();
  step(
    "write key creates a contact (normalized email, source=api)",
    created.status === 201 &&
      contact.email === "api.kisi@example.org" &&
      contact.source === "api",
  );
  step(
    "no internal columns leak into the public contact shape",
    !("organizationId" in contact) && !("engagementScore" in contact),
  );
  const dup = await api(writeKey, "/contacts", {
    method: "POST",
    body: JSON.stringify({ email: "api.kisi@example.org" }),
  });
  step("duplicate → 409", dup.status === 409);
  const list = await (await api(readKey, "/contacts?limit=10")).json();
  step(
    "list returns the contact",
    list.data.some((c) => c.id === contact.id),
  );
  const one = await api(readKey, `/contacts/${contact.id}`);
  step("get by id works", one.status === 200);
  step(
    "invalid id is a clean 404",
    (await api(readKey, "/contacts/not-a-uuid")).status === 404,
  );

  // ---- metering: 6 allowed requests so far? count what was billed
  const used = Number(
    psql(
      `select coalesce(sum(count),0) from api_usage where organization_id='${orgId}'`,
    ),
  );
  step(
    "only authenticated requests are metered (me, denied, create, dup, list, get = 6)",
    used === 6,
    `used=${used}`,
  );
  const over = await api(readKey, "/me");
  const overBody = await over.json();
  step(
    "beyond the plan quota → 402 plan_limit",
    over.status === 402 && overBody.error.code === "plan_limit",
  );
  step(
    "rejected requests are not metered",
    Number(
      psql(
        `select coalesce(sum(count),0) from api_usage where organization_id='${orgId}'`,
      ),
    ) === 6,
  );
  psql(
    `update entitlement_overrides set limit_value = 1000 where organization_id='${orgId}' and entitlement_key='api_requests'`,
  );

  // ---- suppressions via API
  const sup = await api(writeKey, "/suppressions", {
    method: "POST",
    body: JSON.stringify({ emails: ["asla@example.org"], reason: "unsubscribe" }),
  });
  step(
    "suppressions can be added (write scope)",
    sup.status === 200 && (await sup.json()).added === 1,
  );
  const blocked = await api(writeKey, "/contacts", {
    method: "POST",
    body: JSON.stringify({ email: "asla@example.org" }),
  });
  step("a suppressed address cannot be re-added as a contact", blocked.status === 409);

  // ---- update, list membership, suppression listing / export
  const readKey2 = await createKey("Okuma 2", "Okuma");
  const patched = await api(writeKey, `/contacts/${contact.id}`, {
    method: "PATCH",
    body: JSON.stringify({ company: "Acme", custom: {}, city: "Ankara" }),
  });
  const patchedBody = await patched.json();
  step(
    "PATCH updates only the given fields",
    patched.status === 200 &&
      patchedBody.company === "Acme" &&
      patchedBody.city === "Ankara" &&
      patchedBody.firstName === "Api",
  );
  step(
    "PATCH with a read key → 403",
    (
      await api(readKey2, `/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({ city: "x" }),
      })
    ).status === 403,
  );
  const supMove = await api(writeKey, `/contacts/${contact.id}`, {
    method: "PATCH",
    body: JSON.stringify({ email: "asla@example.org" }),
  });
  step("moving a contact onto a suppressed address is refused", supMove.status === 409);
  const listRow = await (
    await page.request.fetch(`${BASE}/api/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      data: { name: "API listesi" },
    })
  ).json();
  const added = await api(writeKey, `/lists/${listRow.id}/contacts`, {
    method: "POST",
    body: JSON.stringify({ contactIds: [contact.id] }),
  });
  step(
    "add a contact to a list",
    added.status === 200 && (await added.json()).added === 1,
  );
  const listsAfter = await (await api(writeKey, "/lists")).json();
  step(
    "the list count reflects it",
    listsAfter.data.find((l) => l.id === listRow.id)?.contactCount === 1,
  );
  const removed = await api(writeKey, `/lists/${listRow.id}/contacts/${contact.id}`, {
    method: "DELETE",
  });
  step(
    "remove it again",
    removed.status === 200 && (await removed.json()).removed === 1,
  );

  // ---- tags and erasure
  const tagMade = await api(writeKey, "/tags", {
    method: "POST",
    body: JSON.stringify({ name: "api-etiket" }),
  });
  const tagId = (await tagMade.json()).id;
  step("create a tag", tagMade.status === 201 && Boolean(tagId));
  step(
    "a duplicate tag is a 409",
    (
      await api(writeKey, "/tags", {
        method: "POST",
        body: JSON.stringify({ name: "api-etiket" }),
      })
    ).status === 409,
  );
  step(
    "a read key cannot create tags",
    (
      await api(readKey, "/tags", {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
      })
    ).status === 403,
  );
  const tagged = await api(writeKey, `/contacts/${contact.id}/tags/${tagId}`, {
    method: "PUT",
  });
  step("tag a contact", tagged.status === 200 && (await tagged.json()).affected === 1);
  const tagsNow = await (await api(readKey, "/tags")).json();
  step(
    "tag list shows the count",
    tagsNow.data.find((t) => t.id === tagId)?.contactCount === 1,
  );
  const untagged = await api(writeKey, `/contacts/${contact.id}/tags/${tagId}`, {
    method: "DELETE",
  });
  step("untag", untagged.status === 200);
  const tmp = await (
    await api(writeKey, "/contacts", {
      method: "POST",
      body: JSON.stringify({ email: `silinecek-${Date.now()}@example.org` }),
    })
  ).json();
  const erased = await api(writeKey, `/contacts/${tmp.id}`, { method: "DELETE" });
  step("erase a contact", erased.status === 200 && (await erased.json()).deleted === 1);
  step(
    "…which is then gone (404)",
    (await api(readKey, `/contacts/${tmp.id}`)).status === 404,
  );
  step(
    "erasing again is a 404",
    (await api(writeKey, `/contacts/${tmp.id}`, { method: "DELETE" })).status === 404,
  );
  const supList = await (await api(readKey2, "/suppressions?limit=10")).json();
  step(
    "suppressions are listed",
    supList.total >= 1 && supList.data.some((s) => s.email === "asla@example.org"),
  );
  step(
    "bad paging is a 400",
    (await api(readKey2, "/suppressions?limit=9999")).status === 400,
  );
  await page.goto(`${BASE}/audience/suppression`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "CSV dışa aktar" }).click(),
  ]);
  const csv = require("node:fs").readFileSync(await download.path(), "utf8");
  step(
    "suppressions export as CSV",
    csv.includes("asla@example.org") && csv.startsWith("\uFEFFE-posta"),
  );
  // keep the dashboard session on the developers page for the steps below
  await page.goto(`${BASE}/settings/developers`);

  // ---- an API key can never reach session-only routes
  const cross = await fetch(`${BASE}/api/campaigns`, {
    headers: { Authorization: `Bearer ${writeKey}` },
  });
  step("a key is not a session: /api/campaigns → 401", cross.status === 401);

  // ---- tenant isolation: a second workspace's key sees none of this
  const ctx2 = await browser.newContext({ locale: "tr-TR" });
  const p2 = await ctx2.newPage();
  await signUpWithOrg(p2, "Diğer Şirket");
  const org2 = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email != '${email}' order by m.created_at desc limit 1`,
  );
  psql(
    `insert into entitlement_overrides (organization_id, entitlement_key, limit_value, reason) values ('${org2}','api_requests',100,'e2e')`,
  );
  await p2.goto(`${BASE}/settings/developers`);
  await p2.getByLabel("Ad", { exact: true }).fill("B");
  await p2.getByLabel("Yetki").selectOption({ label: "Yazma" });
  await p2.getByRole("button", { name: "Anahtar oluştur" }).click();
  const keyB = (await p2.getByTestId("shown-once").innerText()).trim();
  const listB = await (await api(keyB, "/contacts")).json();
  step(
    "another workspace's key sees none of the first workspace's contacts",
    listB.data.length === 0,
  );
  step(
    "…and cannot fetch them by id",
    (await api(keyB, `/contacts/${contact.id}`)).status === 404,
  );

  // ---- revoking in the UI kills the key at once
  await page.reload();
  const row = page.locator("li", { hasText: "Okuma anahtarı" });
  await row.getByRole("button", { name: "İptal et" }).click();
  await page.getByRole("button", { name: "İptal et" }).last().click();
  await row.getByText("İptal edildi").waitFor();
  step(
    "a revoked key stops working immediately",
    (await api(readKey, "/me")).status === 401,
  );

  // ---- webhooks: validation, secret shown once, test ping queued
  await page.getByLabel("Adres (https)").fill("http://169.254.169.254/latest");
  // dev allows http; but a metadata address is not a valid public target when insecure is off, so use https private host
  await page.getByLabel("Adres (https)").fill("https://10.0.0.5/hook");
  await page.getByRole("button", { name: "Webhook ekle" }).click();
  await page.getByText("Bu adrese istek gönderilemez.").waitFor();
  step("private/internal webhook targets are rejected", true);
  await page.getByLabel("Adres (https)").fill("https://example.com/mailory-hook");
  await page.getByRole("button", { name: "Webhook ekle" }).click();
  const secretEl = page.getByTestId("shown-once");
  await secretEl.waitFor();
  const secret = (await secretEl.innerText()).trim();
  step(
    "webhook secret is shown once",
    secret.startsWith("whsec_") &&
      psql(
        `select count(*) from webhook_endpoints where organization_id='${orgId}'`,
      ) === "1",
  );
  await page.getByRole("button", { name: "Kopyaladım, kapat" }).click();
  await page.getByRole("button", { name: "Test gönder" }).click();
  const pings = () =>
    psql(
      `select count(*) from webhook_deliveries where organization_id='${orgId}' and event_type='ping' and status='pending'`,
    );
  for (let i = 0; i < 40 && pings() !== "1"; i++) await page.waitForTimeout(250);
  step("the test ping is queued as a delivery", pings() === "1");
  step(
    "key and webhook actions are audited",
    Number(
      psql(
        `select count(*) from audit_logs where organization_id='${orgId}' and action in ('api_key.created','api_key.revoked','webhook.created')`,
      ),
    ) >= 4,
  );

  await browser.close();
  const unexpected = problems.filter(
    (p) =>
      !/status of (401|402|403|404|409)/.test(p) &&
      !/HTTP (401|402|403|404|409)/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
