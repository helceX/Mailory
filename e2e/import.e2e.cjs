/*
 * Browser e2e for importing a third-party HTML email template (ZIP with images) and editing it as raw HTML.
 * Run against `next dev` (see automation.e2e.cjs for the setup).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8 } = require("../apps/web/node_modules/fflate");
const { BASE, psql, makeSteps, png, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();

const html = `<!DOCTYPE html><html><head><title>Hoş geldin</title>
<style>.wrap{width:600px;margin:0 auto} @media (max-width:600px){.wrap{width:100%}} body{position:fixed}</style></head>
<body bgcolor="#f0f0f0"><table class="wrap" width="600" bgcolor="#ffffff"><tr><td style="padding:24px;font-family:Arial">
<img src="images/hero.png" width="552" alt="Hero"><h1 style="color:#0a7f5a">Merhaba *|FNAME|*</h1>
<p>Bu bir Envato tarzı şablondur. <script>document.title='x'</script></p>
<a href="https://example.com/kampanya" style="background:#0a7f5a;color:#fff;padding:12px 20px">Kampanyayı gör</a>
<form action="https://evil.example"><input name="x"></form></td></tr></table></body></html>`;

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "İçe Aktarma Test");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imp-"));
  const zipPath = path.join(dir, "envato-sablon.zip");
  fs.writeFileSync(
    zipPath,
    Buffer.from(
      zipSync({
        "Envato/index.html": strToU8(html),
        "Envato/images/hero.png": new Uint8Array(png(40, 20, [10, 127, 90])),
      }),
    ),
  );

  await page.goto(`${BASE}/templates`);
  await page.getByRole("button", { name: "HTML içe aktar" }).click();
  await page.getByLabel("Şablon adı").fill("Envato Hoş geldin");
  await page.getByLabel(/Dosya/).setInputFiles(zipPath);
  await page.getByRole("button", { name: "İçe aktar", exact: true }).click();
  await page.getByText("Şablon içe aktarıldı.").waitFor();
  const dialog = await page.getByRole("dialog").innerText();
  step(
    "import reports what it did (tags, image, unsubscribe)",
    /birleştirme etiketi/.test(dialog) &&
      /1 görsel/.test(dialog) &&
      /abonelikten çık/i.test(dialog),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-result.png` });
  await page.getByRole("button", { name: "Şablonu aç" }).click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}/);

  const area = page.locator("#raw-html");
  await area.waitFor();
  const stored = await area.inputValue();
  step(
    "editor switches to the HTML panel (no block palette)",
    (await page.getByRole("complementary", { name: "Bloklar" }).count()) === 0,
  );
  step(
    "stored HTML is sanitized and tags translated",
    !/script|<form|evil\.example/.test(stored) &&
      stored.includes("{{first_name}}") &&
      /src="\/a\/[0-9a-f-]{36}"/.test(stored),
  );
  step(
    "dangerous CSS is dropped, responsive CSS kept",
    !/position/.test(await page.locator("#raw-css").inputValue()) &&
      /@media/.test(await page.locator("#raw-css").inputValue()),
  );
  step(
    "local image became a tenant asset",
    psql(`select count(*) from assets where organization_id='${orgId}'`) === "1",
  );

  // edit + preview
  await area.fill(
    stored.replace("Bu bir Envato tarzı şablondur.", "Düzenlenmiş metin."),
  );
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page
    .getByText(/kayıtlı|Kaydedildi/)
    .first()
    .waitFor();
  await page.getByRole("tab", { name: "Önizleme" }).click();
  const frame = page.frameLocator('iframe[title="E-posta önizlemesi"]');
  await frame.getByText("Düzenlenmiş metin.").waitFor();
  step(
    "preview renders the edited template with merge values",
    (await frame.getByRole("heading").innerText()).includes("Ayşe"),
  );
  step(
    "preview has the unsubscribe link",
    (await frame.locator('a[href*="/unsubscribe/"], a[href*="/u/"]').count()) >= 1 ||
      (await frame.locator("a").count()) >= 2,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-preview.png` });
  await page.getByRole("tab", { name: "Düzenle" }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/import-editor.png` });

  step(
    "the import is audited",
    psql(
      `select count(*) from audit_logs where organization_id='${orgId}' and action='template.imported'`,
    ) === "1",
  );
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
