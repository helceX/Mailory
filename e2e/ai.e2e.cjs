/*
 * Browser e2e for the AI assistant. Run against `next dev` started with AI_PROVIDER=mock (see automation.e2e.cjs).
 * Checks the opt-in gate, suggestions that only a click can apply, the draft→save flow, and that nothing is sent.
 */
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "AI Test Şirketi");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const call = (path, method, body) =>
    page.request.fetch(`${BASE}${path}`, { method, headers, data: body });
  const tpl = await (
    await call("/api/templates", "POST", { name: "AI şablonu", category: "newsletter" })
  ).json();
  const camp = await (
    await call("/api/campaigns", "POST", { name: "AI kampanyası" })
  ).json();
  await call(`/api/campaigns/${camp.id}`, "PATCH", {
    subject: "Eski konu",
    templateId: tpl.id,
    audience: { kind: "all" },
  });

  // Off by default.
  await page.goto(`${BASE}/campaigns/${camp.id}`);
  await page
    .getByText(/bu çalışma alanı için kapalı/)
    .first()
    .waitFor();
  step("AI is off by default for a new workspace", true);
  const blocked = await call(`/api/campaigns/${camp.id}/ai/subjects`, "POST");
  step("API refuses while disabled (409)", blocked.status() === 409);

  // Admin opts in.
  await page.goto(`${BASE}/campaigns`);
  await page.getByLabel("Yapay zekâ yardımcısını aç").check();
  await page.waitForTimeout(700);
  step(
    "an admin can opt the workspace in",
    psql(`select ai_enabled from organizations where id='${orgId}'`) === "t",
  );

  await page.goto(`${BASE}/campaigns/${camp.id}`);
  await page.getByRole("button", { name: "Konu önerileri" }).click();
  await page.getByText("Mart bülteni: yenilikler ve ipuçları").waitFor();
  step("subject suggestions appear", true);
  const before = await page.getByLabel("Konu satırı", { exact: true }).inputValue();
  step("suggestions do not change the subject by themselves", before === "Eski konu");
  await page.getByRole("button", { name: "İçerik incelemesi" }).click();
  await page.getByText("Mesaj anlaşılır; çağrı net.").waitFor();
  step("content review appears", true);
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/ai-suggestions.png`, fullPage: true });
  await page.getByText("Mart bülteni: yenilikler ve ipuçları").click();
  const after = await page.getByLabel("Konu satırı", { exact: true }).inputValue();
  step(
    "clicking 'Kullan' fills the subject (unsaved until the user saves)",
    after === "Mart bülteni: yenilikler ve ipuçları" &&
      psql(`select subject from campaigns where id='${camp.id}'`) === "Eski konu",
  );

  // Draft → save as a NEW template.
  await page.goto(`${BASE}/templates`);
  const tplCount = () =>
    Number(psql(`select count(*) from templates where organization_id='${orgId}'`));
  const base = tplCount();
  await page.getByRole("button", { name: "Yapay zekâ ile taslak" }).click();
  await page
    .getByLabel("Açıklama")
    .fill("Yaz indirimini duyuran kısa ve samimi bir e-posta");
  await page.getByRole("button", { name: "Taslak oluştur" }).click();
  await page.getByLabel("Taslak önizlemesi").waitFor();
  step("a draft is previewed but not saved", tplCount() === base);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ai-draft.png` });
  await page.getByRole("button", { name: "Şablon olarak kaydet" }).click();
  await page.waitForURL(/templates\/[0-9a-f-]{36}/);
  step("saving creates one new template and opens it", tplCount() === base + 1);

  step(
    "nothing was sent or queued by any AI action",
    psql(
      `select (select count(*) from campaign_recipients where organization_id='${orgId}') + (select count(*) from email_outbox where kind='campaign_test' and to_email='${email}')`,
    ) === "0",
  );
  step(
    "AI usage is logged without content",
    Number(psql(`select count(*) from ai_requests where organization_id='${orgId}'`)) >=
      3,
  );

  await browser.close();
  const unexpected = problems.filter(
    (p) => !/status of 409/.test(p) && !/HTTP 409/.test(p),
  );
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
