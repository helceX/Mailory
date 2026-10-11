/*
 * Browser e2e for the dashboard overview: quick actions, attention list, usage vs plan, recent campaigns.
 * Run against `next dev` (see automation.e2e.cjs for the setup).
 */
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Dashboard Test");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const call = (path, method, body) =>
    page.request.fetch(`${BASE}${path}`, { method, headers, data: body });

  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  step(
    "welcomes the user by name",
    (await page.locator("main").innerText()).includes("Hoş geldiniz, E2E"),
  );
  step(
    "quick actions are offered",
    (await page.getByRole("link", { name: "Yeni kampanya" }).count()) === 1,
  );
  step(
    "a workspace with no sender domain is told so (attention list → deliverability)",
    (await page.getByRole("heading", { name: "Dikkat gerektirenler" }).count()) === 1 &&
      (await page.getByText("gönderici alan adı").first().isVisible()),
  );
  step(
    "plan usage is shown with the free plan limits",
    (await page.getByText("Plan kullanımı").isVisible()) &&
      (await page.getByText("500", { exact: false }).first().isVisible()),
  );

  // 80% of the 500-contact free limit → amber hint
  for (let i = 0; i < 20; i++)
    await call("/api/contacts", "POST", {
      email: `d${i}-${Date.now()}@example.org`,
      consentStatus: "granted",
    });
  psql(
    `insert into contacts (organization_id,email,status,consent_status) select '${orgId}','bulk'||g||'@example.org','subscribed','granted' from generate_series(1,380) g`,
  );
  await page.reload();
  step(
    "usage warns at 80% of a limit",
    await page.getByText("Limitin %80'ine ulaştınız.").first().isVisible(),
  );

  // recent campaigns
  const camp = await (
    await call("/api/campaigns", "POST", { name: "Bahar kampanyası" })
  ).json();
  await page.reload();
  const link = page.getByRole("link", { name: "Bahar kampanyası" });
  await link.waitFor();
  step(
    "recent campaigns link to the campaign",
    (await link.getAttribute("href")) === `/campaigns/${camp.id}`,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

  await browser.close();
  const unexpected = problems.filter(
    (p) =>
      !/status of (400|401|402|403|404|409)/.test(p) &&
      !/HTTP (400|401|402|403|404|409)/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
