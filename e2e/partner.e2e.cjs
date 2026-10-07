/*
 * Browser e2e for BTM (partner) admin, sponsored entrepreneurs, the Template Hub, plan limits and platform admin.
 * Run against `next dev` (see automation.e2e.cjs for the setup).
 */
const { execSync } = require("node:child_process");
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const DB =
  process.env.DATABASE_URL || "postgres://mailory:mailory@localhost:5432/mailory";
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

async function registerVerifiedLogin(page, email) {
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: "a-strong-password-1",
      firstName: "Girişimci",
      lastName: "Kişi",
    }),
  });
  const token = psql(
    `select body_text from email_outbox where to_email='${email}' and kind='verify_email'`,
  ).match(/token=(\S+)/)[1];
  await fetch(`${BASE}/api/auth/verify-email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill("a-strong-password-1");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/onboarding|dashboard/);
}

(async () => {
  const { browser, context, page, problems } = await launch();
  const btmEmail = await signUpWithOrg(page, "BTM Test Merkezi");
  const btmOrg = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${btmEmail}'`,
  );
  psql(`update organizations set type='partner' where id='${btmOrg}'`);
  const call = (pg, path, method, body) =>
    pg.request.fetch(`${BASE}${path}`, { method, headers, data: body });

  // ---- platform admin bootstrap is a CLI, not an API
  const noAdmin = await page.goto(`${BASE}/platform`);
  step("before being granted, /platform is a plain 404", noAdmin.status() === 404);
  execSync(`pnpm --filter @mailory/db platform-admin ${btmEmail}`, {
    env: { ...process.env, DATABASE_URL: DB },
    stdio: "pipe",
  });
  step(
    "platform-admin CLI grants rights",
    psql(`select is_platform_admin from users where email='${btmEmail}'`) === "t",
  );

  // ---- BTM opens a workspace for an entrepreneur
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("link", { name: "BTM Admin" }).first().waitFor();
  step("a partner organization gets the BTM Admin menu", true);
  await page.goto(`${BASE}/partner`);
  const childName = `Girişimci ${Date.now()}`;
  const ownerEmail = `girisimci-${Date.now()}@example.com`;
  await page.getByLabel("Ad", { exact: true }).fill(childName);
  await page.getByLabel("Sahibinin e-postası").fill(ownerEmail);
  await page.getByRole("button", { name: "Çalışma alanı aç" }).click();
  await page.getByText(childName).waitFor();
  step(
    "the new workspace appears, waiting for its owner's invitation",
    await page.getByText("Davet bekliyor").first().isVisible(),
  );
  const childId = psql(
    `select id from organizations where parent_organization_id='${btmOrg}' and name='${childName}'`,
  );
  step(
    "child is sponsored on the BTM plan with no BTM member inside",
    psql(
      `select plan_key||'/'||source from subscriptions where organization_id='${childId}'`,
    ) === "btm_sponsored/sponsored" &&
      psql(`select count(*) from memberships where organization_id='${childId}'`) ===
        "0",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/partner.png`, fullPage: true });

  // ---- the entrepreneur accepts and becomes owner
  const ctx2 = await browser.newContext({ locale: "tr-TR" });
  const ent = await ctx2.newPage();
  await registerVerifiedLogin(ent, ownerEmail);
  const token = psql(
    `select body_text from email_outbox where to_email='${ownerEmail}' and kind='invitation' order by created_at desc limit 1`,
  ).match(/token=(\S+)/)[1];
  await ent.goto(`${BASE}/accept-invite?token=${token}`);
  await ent.getByRole("button", { name: "Daveti kabul et" }).click();
  await ent.waitForURL(/dashboard/);
  step(
    "the invited entrepreneur becomes OWNER of the workspace",
    psql(`select role from memberships where organization_id='${childId}'`) === "owner",
  );
  await ent.goto(`${BASE}/settings/plan`);
  await ent.getByText("BTM Sponsorlu").first().waitFor();
  step(
    "the plan page shows the sponsored plan and the sponsor",
    (await ent.locator("main").innerText()).includes("BTM Test Merkezi"),
  );
  step(
    "entrepreneur cannot reach /partner or /platform (404)",
    (await ent.goto(`${BASE}/partner`)).status() === 404 &&
      (await ent.goto(`${BASE}/platform`)).status() === 404,
  );

  // ---- privacy: BTM sees counts, never content
  await call(ent, "/api/contacts", "POST", {
    email: "gizli@example.org",
    firstName: "Gizli",
    consentStatus: "granted",
  });
  await page.goto(`${BASE}/partner/children/${childId}`);
  const childView = await page.locator("main").innerText();
  step(
    "BTM sees the child's usage but none of its content",
    /1 kişi/.test(childView) &&
      !childView.includes("gizli@example.org") &&
      !childView.includes("Gizli"),
  );
  const btmContacts = await (await call(page, "/api/contacts", "GET")).text();
  step(
    "BTM's own contacts API never returns the child's data",
    !btmContacts.includes("gizli@example.org"),
  );

  // ---- BTM sets a limit; the plan is enforced for the child
  await page.getByLabel("Kişi limiti").fill("2");
  await page.getByLabel("Kişi limiti").locator("xpath=following::button[1]").click();
  await page.getByText("Kaydedildi.").first().waitFor();
  step(
    "BTM can lower the child's contact limit",
    psql(
      `select limit_value from entitlement_overrides where organization_id='${childId}' and entitlement_key='contacts'`,
    ) === "2",
  );
  await call(ent, "/api/contacts", "POST", {
    email: "ikinci@example.org",
    consentStatus: "granted",
  });
  const blocked = await call(ent, "/api/contacts", "POST", {
    email: "ucuncu@example.org",
    consentStatus: "granted",
  });
  step(
    "the child is stopped at its limit with HTTP 402 and a clear message",
    blocked.status() === 402 && (await blocked.text()).includes("2 / 2"),
  );
  const over = await call(page, `/api/partner/children/${childId}`, "PATCH", {
    action: "limit",
    key: "contacts",
    limit: 999999,
  });
  step(
    "a partner cannot exceed the cap (403)",
    over.status() === 403,
    `${over.status()} ${(await over.text()).slice(0, 120)}`,
  );

  // ---- Template Hub
  const tpl = await (
    await call(page, "/api/templates", "POST", {
      name: "BTM karşılama",
      category: "newsletter",
    })
  ).json();
  await page.goto(`${BASE}/partner/templates`);
  await page.getByLabel("Yayınlanacak şablon").selectOption({ label: "BTM karşılama" });
  await page.getByRole("button", { name: /Şablon Merkezi'ne yayınla/ }).click();
  await page.getByText("BTM karşılama").nth(1).waitFor();
  step(
    "BTM publishes a template to the hub",
    psql(
      `select count(*) from shared_templates where partner_organization_id='${btmOrg}'`,
    ) === "1",
  );
  void tpl;
  await ent.goto(`${BASE}/templates`);
  await ent.getByRole("link", { name: "BTM Test Merkezi Şablonları" }).click();
  await ent.getByText("BTM karşılama").waitFor();
  await ent.getByRole("button", { name: "Kendi şablonlarıma ekle" }).click();
  await ent.waitForURL(/templates\/[0-9a-f-]{36}/);
  step(
    "the entrepreneur copies it into its own templates",
    psql(
      `select count(*) from templates where organization_id='${childId}' and name='BTM karşılama'`,
    ) === "1",
  );
  if (SHOTS) await ent.screenshot({ path: `${SHOTS}/hub-copy.png` });

  // ---- platform admin
  await page.goto(`${BASE}/platform`);
  await page.getByText(childName).first().waitFor();
  step("platform admin lists every workspace with aggregates", true);
  await page.goto(`${BASE}/platform/system`);
  await page.getByRole("heading", { name: "Sistem durumu" }).waitFor();
  step("system status page renders", true);
  await page.goto(`${BASE}/platform/orgs/${childId}`);
  await page.getByLabel("Askıya alma gerekçesi").fill("e2e testi");
  await page.getByRole("button", { name: "Askıya al" }).click();
  await page.getByRole("button", { name: "Askıya al" }).last().click();
  await page.getByText("Askıya alındı").first().waitFor();
  step(
    "platform admin can suspend a workspace",
    psql(`select suspended_reason from organizations where id='${childId}'`) ===
      "e2e testi",
  );
  await ent.goto(`${BASE}/settings/plan`);
  await ent.getByText("Askıya alındı").first().waitFor();
  step("the suspended workspace sees it on its plan page", true);
  const audit = psql(
    `select count(*) from audit_logs where organization_id='${childId}' and action in ('partner.child_created','partner.limit_set','platform.suspended')`,
  );
  step("every sponsor/platform action is audited on the child", audit === "3");

  await browser.close();
  void context;
  const unexpected = problems.filter(
    (p) => !/status of (402|403|404)/.test(p) && !/HTTP (402|403|404)/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
