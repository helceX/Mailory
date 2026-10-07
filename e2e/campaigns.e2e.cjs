/*
 * Browser e2e for campaigns: draft wizard, readiness, preview, test send, scheduling and four-eyes approval.
 * Run against `next dev` (see senders.e2e.cjs) — it needs no DNS, the domain is marked verified directly in the DB.
 */
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

async function registerVerified(email) {
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: "a-strong-password-1",
      firstName: "Onay",
      lastName: "Veren",
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
}

(async () => {
  const { browser, context, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Kampanya Test Şirketi");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );

  // Seed: verified domain + identity + template + 3 contacts (one unsubscribed => must not be counted).
  const domain = `camp-${Date.now()}.com`;
  psql(
    `insert into sender_domains(organization_id,domain,status,provider,dkim_tokens,ownership_token,verified_at) values('${orgId}','${domain}','verified','mock',to_jsonb(array['a','b','c']),'${"o".repeat(32)}',now())`,
  );
  const call = async (path, method, body) =>
    page.request.fetch(`${BASE}${path}`, { method, headers, data: body });
  const ident = await call("/api/sender-identities", "POST", {
    fromName: "Acme",
    fromEmail: `info@${domain}`,
    replyTo: "",
  });
  step(
    "seed: sender identity on verified domain",
    ident.status() === 201,
    String(ident.status()),
  );
  const tpl = await call("/api/templates", "POST", {
    name: "Aylık bülten",
    category: "newsletter",
  });
  step("seed: template", tpl.status() === 201, String(tpl.status()));
  for (const [i, status] of [
    ["a", "subscribed"],
    ["b", "subscribed"],
    ["c", "unsubscribed"],
  ]) {
    psql(
      `insert into contacts(organization_id,email,status,consent_status) values('${orgId}','${i}-${Date.now()}@example.org','${status}','granted')`,
    );
  }

  // ---- list + create
  await page.goto(`${BASE}/campaigns`);
  await page.getByText("Bu görünümde kampanya yok.").waitFor();
  step("campaigns: empty state", true);
  await page.getByRole("button", { name: "Yeni kampanya" }).click();
  await page.getByLabel("Kampanya adı").fill("Yaz Kampanyası");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
  const campaignId = page.url().split("/").pop();
  step("create campaign opens the editor", true);

  // ---- readiness: nothing filled in yet
  await page.getByText("Konu satırı boş.").waitFor();
  const sendBtn = page.getByRole("button", { name: "Gönder", exact: true });
  step("send is disabled while blockers exist", await sendBtn.isDisabled());

  // ---- fill the wizard
  await page
    .getByLabel("Konu satırı")
    .fill("Merhaba {{first_name|dost}}, yaz fırsatları");
  await page
    .getByLabel("Şablon", { exact: true })
    .selectOption({ label: "Aylık bülten" });
  await page.getByLabel("Kime").selectOption("all");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Kaydedildi.").waitFor();
  await page.getByText("Her şey hazır.").waitFor();
  const count = await page.getByText(/Gönderilebilir alıcı:/).innerText();
  step(
    "readiness clears and audience excludes unsubscribed (2)",
    /\b2\b/.test(count),
    count,
  );

  // ---- preview (sandboxed iframe, UTM applied)
  await page.getByRole("button", { name: "Önizle" }).click();
  const frame = page.locator('iframe[title="E-posta önizlemesi"]');
  await frame.waitFor();
  const sandbox = await frame.getAttribute("sandbox");
  const srcdoc = await frame.getAttribute("srcdoc");
  step(
    "preview renders in a fully sandboxed iframe",
    sandbox === "" && srcdoc.includes("<html"),
  );
  step(
    "preview unsubscribe link is untagged",
    !/unsubscribe\/preview[^"]*utm_/.test(srcdoc),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campaign-preview.png` });
  await page.keyboard.press("Escape");

  // ---- test send
  await page.getByRole("button", { name: "Test gönder" }).click();
  await page.getByRole("button", { name: "Gönder", exact: true }).last().click();
  await page.getByText("1 test e-postası gönderildi.").waitFor();
  const outbox = psql(
    `select count(*) from email_outbox where to_email='${email}' and kind='campaign_test' and subject like '[TEST]%'`,
  );
  step("test send reaches the outbox with a [TEST] subject", outbox === "1", outbox);
  await page.keyboard.press("Escape");
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/campaign-editor.png`, fullPage: true });

  // ---- schedule for later (policy off): confirm dialog
  await page.getByLabel("İleri bir tarihte").check();
  await page.getByLabel("Gönderim tarihi ve saati").fill("2030-01-01T09:00");
  const tooFar = page.getByRole("button", { name: "Zamanla" });
  await tooFar.click();
  await page.getByRole("button", { name: "Zamanla" }).last().click();
  await page.getByRole("alert").first().waitFor();
  step(
    "a send time over a year away is refused",
    psql(`select status from campaigns where id='${campaignId}'`) === "draft",
  );
  const soon = new Date(Date.now() + 2 * 86400_000);
  const pad = (n) => String(n).padStart(2, "0");
  await page
    .getByLabel("Gönderim tarihi ve saati")
    .fill(
      `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T09:00`,
    );
  await page.getByRole("button", { name: "Zamanla" }).first().click();
  await page.getByRole("button", { name: "Zamanla" }).last().click();
  await page.getByText("Zamanlandı").first().waitFor();
  step(
    "scheduling freezes the campaign",
    psql(`select status from campaigns where id='${campaignId}'`) === "scheduled",
  );
  step(
    "snapshot stores the audience count",
    psql(
      `select (snapshot->>'audienceCount')::int from campaigns where id='${campaignId}'`,
    ) === "2",
  );
  const editable = await page.getByLabel("Konu satırı").count();
  step("a scheduled campaign is no longer editable", editable === 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/campaign-scheduled.png` });
  await page.getByRole("button", { name: "Taslağa geri çek" }).click();
  await page.getByLabel("Konu satırı").waitFor();
  step(
    "withdrawing returns an editable draft",
    psql(`select status from campaigns where id='${campaignId}'`) === "draft",
  );

  // ---- four-eyes approval
  await page.goto(`${BASE}/campaigns`);
  const policy = page.getByLabel("Kampanyalar için onay gereksin");
  await policy.check();
  await page.waitForTimeout(600);
  step(
    "approval policy can be switched on",
    psql(`select require_campaign_approval from organizations where id='${orgId}'`) ===
      "t",
  );
  await page.goto(`${BASE}/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Onaya gönder" }).click();
  await page.getByText("Onay bekliyor").first().waitFor();
  step(
    "submit moves to pending approval",
    psql(`select status from campaigns where id='${campaignId}'`) ===
      "pending_approval",
  );
  step(
    "submitter cannot approve their own campaign",
    (await page.getByRole("button", { name: "Onayla" }).count()) === 0,
  );

  const email2 = `e2e-approver-${Date.now()}@example.com`;
  await registerVerified(email2);
  psql(
    `insert into memberships(organization_id,user_id,role) select '${orgId}', id, 'admin' from users where email='${email2}'`,
  );
  const page2 = await context
    .browser()
    .newContext({ locale: "tr-TR" })
    .then((c) => c.newPage());
  await page2.goto(`${BASE}/login`);
  await page2.getByLabel("E-posta").fill(email2);
  await page2.getByLabel("Parola").fill("a-strong-password-1");
  await page2.getByRole("button", { name: "Giriş yap" }).click();
  await page2.waitForURL(/dashboard/);
  await page2.goto(`${BASE}/campaigns/${campaignId}`);
  await page2.getByRole("button", { name: "Onayla", exact: true }).click();
  await page2.getByText("Zamanlandı").first().waitFor();
  step(
    "a different admin approves → scheduled",
    psql(`select status from campaigns where id='${campaignId}'`) === "scheduled",
  );
  step(
    "approval is audited",
    Number(
      psql(
        `select count(*) from audit_logs where entity_id='${campaignId}' and action='campaign.approved'`,
      ),
    ) === 1,
  );

  await browser.close();
  const unexpected = problems.filter(
    (p) =>
      !/status of (400|422|409)/.test(p) &&
      !/HTTP (400|422|409) \/api\/campaigns/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || (unexpected.length ? 1 : 0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
