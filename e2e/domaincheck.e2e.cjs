/*
 * Browser e2e for the PUBLIC free domain-health tool (no login). Needs the server started with
 * DNS_RESOLVER=mock MOCK_DNS_FILE=<file> (the test "publishes DNS" by writing that zone file).
 */
const fs = require("node:fs");
const { BASE, makeSteps, launch } = require("./lib.cjs");

const ZONE = process.env.MOCK_DNS_FILE || "/tmp/mailory-mock-dns.json";
const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();

(async () => {
  const { browser, page, problems } = await launch();
  const stamp = Date.now();
  const good = `iyi-${stamp}.com`;
  const bad = `bos-${stamp}.com`;
  fs.writeFileSync(
    ZONE,
    JSON.stringify({
      [good]: { TXT: ["v=spf1 include:amazonses.com ~all"], MX: [`mx.${good}`] },
      [`_dmarc.${good}`]: { TXT: ["v=DMARC1; p=reject; rua=mailto:d@" + good] },
      [`google._domainkey.${good}`]: { TXT: ["v=DKIM1; k=rsa; p=MIGf"] },
    }),
  );

  const res = await page.goto(`${BASE}/domain-check`);
  step(
    "the tool is public (no login needed)",
    res.status() === 200 &&
      /Alan adı e-posta sağlık raporu/.test(await page.locator("h1").innerText()),
  );

  await page.getByLabel("Alan adınız").fill(good);
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await page.getByText("100/100").waitFor();
  step(
    "a correctly configured domain scores 100 with no findings",
    (await page.getByText("düzgün görünüyor").count()) === 1 &&
      (await page.getByText("google").count()) >= 1,
  );

  await page.getByLabel("Alan adınız").fill(bad);
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await page.getByText("SPF kaydı yok.").waitFor();
  const text = await page.locator("main").innerText();
  step(
    "an empty domain gets explained findings with what to do",
    /DMARC kaydı yok/.test(text) &&
      /Ne yapmalı: Alan adınıza bir TXT kaydı ekleyin/.test(text) &&
      /Riskli/.test(text),
  );
  step(
    "the page invites the visitor to sign up",
    (await page.getByRole("link", { name: "Ücretsiz dene" }).getAttribute("href")) ===
      "/register",
  );
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/domain-check.png`, fullPage: true });

  await page.getByLabel("Alan adınız").fill("localhost");
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await page.getByText(/Geçerli bir alan adı girin/).waitFor();
  step("an invalid name is rejected politely", true);
  const ip = await fetch(`${BASE}/api/public/domain-check?domain=10.0.0.1`);
  step("an IP address is rejected", ip.status === 400);
  const url = await fetch(
    `${BASE}/api/public/domain-check?domain=${encodeURIComponent("https://www." + good + "/yol?x=1")}`,
  );
  step(
    "a pasted URL is reduced to its hostname",
    url.status === 200 && (await url.json()).domain === good,
  );

  // rate limit: 10 per hour per client (3 UI calls + 2 above already used)
  let limited = 0;
  for (let i = 0; i < 12; i++)
    if ((await fetch(`${BASE}/api/public/domain-check?domain=${good}`)).status === 429)
      limited++;
  step("abuse is rate-limited (429)", limited >= 1);

  await browser.close();
  const unexpected = problems.filter(
    (p) => !/status of (400|429)/.test(p) && !/HTTP (400|429)/.test(p),
  );
  if (unexpected.length) console.log("\nBrowser problems:\n" + unexpected.join("\n"));
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
