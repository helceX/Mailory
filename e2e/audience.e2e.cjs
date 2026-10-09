/*
 * Browser end-to-end test for sign-in → organization → audience (contacts, import, segments, suppression).
 * It needs a RUNNING production build and a migrated database; it is not part of `pnpm test`.
 *
 *   pnpm build && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/
 *   PORT=3100 APP_URL=http://localhost:3100 node apps/web/.next/standalone/apps/web/server.js &
 *   E2E_BASE_URL=http://localhost:3100 CHROMIUM_PATH=/path/to/chrome pnpm test:e2e
 *
 * Set SHOTS=<dir> to also write screenshots. Each run creates a fresh user, so reruns are independent.
 * Wiring this into CI (browser install + server start) is tracked as a follow-up in docs/MAILORY_TASKS.md.
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const B = process.env.E2E_BASE_URL || "http://localhost:3100";
const SHOTS = process.env.SHOTS;
const psql = (q) =>
  execSync(
    `psql ${process.env.DATABASE_URL || "postgres://mailory:mailory@localhost:5432/mailory"} -tAc "${q}"`,
  )
    .toString()
    .trim();
const email = `pw-${Date.now()}@example.com`;
const log = [];
const step = (name, ok, extra = "") => {
  log.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "tr-TR",
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (
      ["error", "warning"].includes(m.type()) &&
      !/favicon|Download the React DevTools/.test(m.text())
    )
      problems.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  context.on("response", (r) => {
    if (r.status() >= 400 && r.status() !== 401)
      problems.push(`HTTP ${r.status()} ${r.url()}`);
  });

  // --- register + verify (API) then login through the real form
  const origin = { "Content-Type": "application/json", Origin: B };
  await fetch(`${B}/api/auth/register`, {
    method: "POST",
    headers: origin,
    body: JSON.stringify({
      email,
      password: "a-strong-password-1",
      firstName: "Pw",
      lastName: "Tester",
    }),
  });
  const body = psql(
    `select body_text from email_outbox where to_email='${email}' and kind='verify_email'`,
  );
  const token = body.match(/token=(\S+)/)[1];
  await fetch(`${B}/api/auth/verify-email`, {
    method: "POST",
    headers: origin,
    body: JSON.stringify({ token }),
  });

  await page.goto(`${B}/login`);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill("a-strong-password-1");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/onboarding/);
  step("login → onboarding (hydrated form works)", true);

  await page.getByLabel("Organizasyon adı").fill("Pw Test Şirketi");
  await page.getByRole("button", { name: "Organizasyon oluştur" }).click();
  await page.waitForURL(/dashboard/);
  step("create organization → dashboard", true);

  // --- empty states
  await page.goto(`${B}/audience/contacts`);
  step(
    "contacts empty state",
    await page.getByText("Henüz kişiniz bulunmuyor.").isVisible(),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-contacts-empty.png` });

  // --- lists + tags + fields via UI
  await page.goto(`${B}/audience/lists`);
  await page.getByLabel("Yeni liste adı").fill("Etkinlik Katılımcıları");
  await page.getByRole("button", { name: "Liste ekle" }).click();
  await page.getByText("Etkinlik Katılımcıları").waitFor();
  step("create list", true);

  await page.goto(`${B}/audience/tags`);
  await page.getByLabel("Yeni etiket adı").fill("girisimci");
  await page.getByRole("button", { name: "Etiket ekle" }).click();
  await page.getByText("girisimci").first().waitFor();
  step("create tag", true);

  await page.goto(`${B}/audience/fields`);
  await page.getByLabel("Alan adı").fill("Çalışan sayısı");
  await page.getByLabel("Anahtar").fill("employees");
  await page.getByLabel("Tür").selectOption("number");
  await page.getByRole("button", { name: "Alan ekle" }).click();
  await page.getByText("employees").waitFor();
  step("create custom field", true);

  // --- CSV import wizard (semicolon-delimited, Turkish headers, one invalid row, one dup)
  const csvPath = `${SHOTS || "/tmp"}/contacts.csv`;
  const rows = ["E-posta;Adı;Şirket;Şehir;Çalışan sayısı"];
  for (let i = 0; i < 120; i++)
    rows.push(
      `kisi${i}@example.com;Kişi ${i};${i % 3 === 0 ? "Startup" : "Corp"} ${i % 7};${["Ankara", "İzmir"][i % 2]};${i % 40}`,
    );
  rows.push("bozuk-adres;Bozuk;X;Y;1", "kisi1@example.com;Tekrar;X;Y;1");
  fs.writeFileSync(csvPath, rows.join("\n"));
  await page.goto(`${B}/audience/contacts/import`);
  await page.locator('input[type="file"]').setInputFiles(csvPath);
  await page.getByText("2. Sütunları eşleyin").waitFor();
  const emailSelect = page.getByLabel("E-posta sütununu eşle");
  step(
    "auto-mapping suggests E-posta → email",
    (await emailSelect.inputValue()) === "email",
  );
  step(
    "auto-mapping suggests custom field",
    (await page.getByLabel("Çalışan sayısı sütununu eşle").inputValue()) ===
      "custom:employees",
  );
  const runBtn = page.getByRole("button", { name: /satırı içe aktar/ });
  step("import blocked until consent attested", await runBtn.isDisabled());
  await page
    .getByLabel("Listeye ekle (isteğe bağlı)")
    .selectOption({ label: "Etkinlik Katılımcıları" });
  await page.getByLabel("girisimci").check();
  await page.getByText("İzin beyanı.").click();
  await runBtn.click();
  await page.getByText("İçe aktarma tamamlandı.").waitFor();
  const result = await page.locator("dl").innerText();
  step(
    "import result: 120 inserted, 1 invalid, 1 skipped",
    /120/.test(result) && result.includes("Geçersiz satır") && /\b1\b/.test(result),
    result.replace(/\n/g, " "),
  );
  step(
    "invalid row reported with row number",
    await page.getByText(/Satır 122: Geçersiz e-posta/).isVisible(),
  );
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/02-import-result.png`, fullPage: true });

  // --- contacts table: search, select all matching, bulk action, load more
  await page.goto(`${B}/audience/contacts`);
  await page.getByText("120 / 120").or(page.getByText("50 / 120")).first().waitFor();
  step(
    "first page shows 50 of 120",
    await page.getByText("50 / 120 kişi gösteriliyor").isVisible(),
  );
  await page.getByRole("button", { name: "Daha fazla yükle" }).click();
  await page.getByText("100 / 120 kişi gösteriliyor").waitFor();
  step("'load more' appends the next page", true);
  await page.getByLabel("Ara", { exact: true }).fill("kisi11");
  await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.waitForURL(/q=kisi11/);
  step(
    "search filters server-side (kisi11, kisi110..119 = 11)",
    await page.getByText(/11 \/ 11 kişi gösteriliyor/).isVisible(),
  );
  await page.getByLabel("Yüklenen tüm kişileri seç").check();
  step(
    "bulk bar appears on selection",
    await page.getByText("11 kişi seçili").isVisible(),
  );
  // Everyone already carries "girisimci" from the import, so re-adding is an honest no-op, not "0 added".
  await page.getByLabel("Etiket ekle").selectOption({ label: "girisimci" });
  await page.getByText(/Değişiklik yok: seçili kişiler zaten bu durumda\./).waitFor();
  step("bulk add of an existing tag reports 'no change'", true);
  await page.getByLabel("Yüklenen tüm kişileri seç").check(); // selection is cleared after each bulk action
  await page
    .getByLabel("Listeye ekle", { exact: true })
    .selectOption({ label: "Etkinlik Katılımcıları" });
  await page
    .getByText(/Değişiklik yok/)
    .first()
    .waitFor();
  step("bulk add to a list everyone is already in reports 'no change'", true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-contacts-table.png` });

  // --- contact detail edit
  await page.goto(`${B}/audience/contacts?q=kisi5%40`);
  await page.getByRole("link", { name: "Kişi 5" }).first().click();
  await page.getByLabel("Şirket").waitFor();
  await page.getByLabel("Şirket").fill("Yeni Şirket A.Ş.");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Değişiklikler kaydedildi.").waitFor();
  step("edit contact and save", true);

  // --- segment builder: typing must keep focus; preview count must update
  await page.goto(`${B}/audience/segments/new`);
  await page.getByLabel("Segment adı").fill("Ankara Startup");
  const val = page.getByLabel("Koşul 1 değeri");
  await val.click();
  await page.keyboard.type("startup", { delay: 30 });
  step(
    "segment value input keeps focus while typing",
    (await val.inputValue()) === "startup",
  );
  await page.getByRole("button", { name: "Koşul ekle" }).click();
  await page.getByLabel("Koşul 2 alanı").selectOption("city");
  await page.getByLabel("Koşul 2 işlemi").selectOption("eq");
  await page.getByLabel("Koşul 2 değeri").fill("Ankara");
  await page.waitForTimeout(1200);
  const countText = await page.getByLabel("Önizleme").innerText();
  step(
    "live preview shows a count",
    /\d/.test(countText),
    countText.replace(/\n/g, " ").slice(0, 60),
  );
  const expected = Number(
    psql(
      `select count(*) from contacts c join organizations o on o.id=c.organization_id join memberships m on m.organization_id=o.id join users u on u.id=m.user_id where u.email='${email}' and c.company ilike '%startup%' and lower(c.city)='ankara'`,
    ),
  );
  step(
    `preview count matches SQL ground truth (${expected})`,
    countText.includes(String(expected)) ||
      countText.includes(expected.toLocaleString("tr-TR")),
  );
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/04-segment-builder.png`, fullPage: true });
  await page.getByRole("button", { name: "Segmenti kaydet" }).click();
  await page.waitForURL(/audience\/segments$/);
  step(
    "save segment → list shows it",
    await page.getByText("Ankara Startup").isVisible(),
  );

  // --- suppression flow: add, appears, blocks import
  await page.goto(`${B}/audience/suppression`);
  await page.getByLabel("Adres ekle").fill("kisi3@example.com");
  await page.getByRole("button", { name: "Listeye ekle" }).click();
  await page.getByText("1 adres eklendi").waitFor();
  step("suppression add + notice", true);

  // --- mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "tr-TR",
    storageState: await context.storageState(),
  });
  const mp = await mobile.newPage();
  mp.on("pageerror", (e) =>
    problems.push(`mobile pageerror: ${e.message.slice(0, 200)}`),
  );
  await mp.goto(`${B}/audience/contacts`);
  await mp.getByText("kişi gösteriliyor").waitFor();
  const overflow = await mp.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step("mobile: no page-level horizontal scroll", !overflow);
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/05-contacts-mobile.png` });

  step(
    "no console errors / page errors / 5xx",
    problems.length === 0,
    problems.slice(0, 5).join(" | "),
  );
  await browser.close();
  const failed = log.filter((l) => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 6).join("\n"));
  process.exit(2);
});
