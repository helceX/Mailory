/*
 * Browser e2e for sender domains, sender identities and the onboarding checklist.
 * Needs a running production build started with DNS_RESOLVER=mock MOCK_DNS_FILE=<file> (see audience.e2e.cjs).
 * The test "publishes DNS" by writing the mock zone file, exactly what a customer's DNS panel would do.
 */
const fs = require("node:fs");
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const ZONE = process.env.MOCK_DNS_FILE || "/tmp/mailory-mock-dns.json";
const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();

(async () => {
  const { browser, page, problems } = await launch();
  fs.writeFileSync(ZONE, "{}");
  await signUpWithOrg(page, "Sender Test Şirketi");

  // Fresh workspace: checklist with the sender/domain steps open.
  await page
    .getByRole("heading", { name: /Kurulum|Başlarken|Hazırlık/i })
    .first()
    .waitFor();
  step("dashboard shows the onboarding checklist", true);

  await page.goto(`${BASE}/settings/domains`);
  await page.getByText("Henüz doğrulanmış bir alan adınız yok.").waitFor();
  step("domains: empty state", true);

  // Free-mail domains are refused.
  await page.getByLabel("Alan adı ekle").fill("gmail.com");
  await page.getByRole("button", { name: "Alan adı ekle" }).click();
  await page.getByRole("alert").first().waitFor();
  step("free-mail domain is rejected with an error", true);

  const domain = `e2e-${Date.now()}.com`;
  await page.getByLabel("Alan adı ekle").fill(domain);
  await page.getByRole("button", { name: "Alan adı ekle" }).click();
  await page.waitForURL(/settings\/domains\/[0-9a-f-]{36}/);
  step("adding a domain opens its detail page", true);
  await page.getByText("Henüz kontrol edilmedi").first().waitFor();
  const rows = await page.locator("tbody tr").count();
  step(
    "DNS records table lists ownership + 3 DKIM (+SPF/DMARC)",
    rows >= 4,
    `rows=${rows}`,
  );
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/domain-pending.png`, fullPage: true });

  // Before DNS is published: still pending.
  await page.getByRole("button", { name: "Şimdi kontrol et" }).click();
  await page.waitForTimeout(800);
  const status0 = psql(`select status from sender_domains where domain='${domain}'`);
  step("check without DNS leaves the domain pending", status0 === "pending", status0);

  // Publish the records, as a customer would.
  const id = psql(`select id from sender_domains where domain='${domain}'`);
  const body = await (
    await page.request.get(`${BASE}/api/sender-domains/${id}`)
  ).json();
  const records = (body.data ?? body).records ?? [];
  const zone = {};
  for (const r of records) {
    const e = (zone[r.host] ??= {});
    if (r.type === "TXT") (e.TXT ??= []).push(r.value);
    else (e.CNAME ??= []).push(r.value);
  }
  fs.writeFileSync(ZONE, JSON.stringify(zone));
  step("fetched records for the domain", records.length >= 4, `n=${records.length}`);

  await page.getByRole("button", { name: "Şimdi kontrol et" }).click();
  await page.waitForFunction(() => /Doğrulandı/.test(document.body.innerText), null, {
    timeout: 10_000,
  });
  const status1 = psql(`select status from sender_domains where domain='${domain}'`);
  step("after publishing DNS the domain verifies", status1 === "verified", status1);
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/domain-verified.png`, fullPage: true });

  // Sender identity on the verified domain is usable; one on another domain is not.
  await page.goto(`${BASE}/settings/senders`);
  await page.getByLabel("Gönderici adı").fill("Acme");
  await page.getByLabel("Gönderici e-posta").fill(`info@${domain}`);
  await page.getByRole("button", { name: "Gönderici ekle" }).click();
  await page.getByText(`info@${domain}`).first().waitFor();
  step("identity on a verified domain is added", true);

  await page.getByLabel("Gönderici adı").fill("Other");
  await page.getByLabel("Gönderici e-posta").fill("hello@not-verified-example.org");
  await page.getByRole("button", { name: "Gönderici ekle" }).click();
  await page.getByText("hello@not-verified-example.org").first().waitFor();
  const list = await (await page.request.get(`${BASE}/api/sender-identities`)).json();
  const items = list.data?.identities ?? list.data ?? list.identities ?? [];
  const byEmail = Object.fromEntries(items.map((i) => [i.fromEmail, i]));
  step(
    "identity usability follows domain verification",
    byEmail[`info@${domain}`]?.usable === true &&
      byEmail["hello@not-verified-example.org"]?.usable === false,
    JSON.stringify(items.map((i) => [i.fromEmail, i.usable])),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/senders.png`, fullPage: true });

  // Checklist now reflects progress.
  await page.goto(`${BASE}/dashboard`);
  const text = await page.locator("main").innerText();
  const ob = await (await page.request.get(`${BASE}/api/onboarding`)).json();
  const steps = ob.data?.steps ?? ob.steps ?? [];
  const done = (k) => steps.find((x) => x.key === k)?.done;
  step(
    "onboarding API: sender + domain steps done",
    done("sender") && done("domain"),
    JSON.stringify(steps.map((x) => [x.key, x.done])),
  );
  void text;

  await browser.close();
  // The deliberate free-mail rejection produces one expected 400 (+ its console line).
  const unexpected = problems.filter(
    (p) => !/HTTP 400 \/api\/sender-domains$/.test(p) && !/status of 400/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || (unexpected.length ? 1 : 0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
