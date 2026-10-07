/*
 * Browser e2e for Brand Kit, template library and the drag-and-drop email editor.
 * Needs a running production build + migrated DB (see e2e/audience.e2e.cjs for the recipe).
 * SHOTS=<dir> also writes screenshots (editor, preview desktop/mobile).
 */
const fs = require("node:fs");
const { BASE, psql, makeSteps, png, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const tmp = SHOTS || "/tmp";
const { step, finish } = makeSteps();

(async () => {
  const { browser, context, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Tpl Test Şirketi");
  const orgId = () =>
    psql(
      `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
    );

  // ---------------------------------------------------------------- brand kit
  const logoPath = `${tmp}/e2e-logo.png`;
  fs.writeFileSync(logoPath, png(160, 48, [10, 127, 90]));
  await page.goto(`${BASE}/brand-kit`);
  await page.locator('input[type="file"]').setInputFiles(logoPath);
  await page.getByAltText("Mevcut logo").waitFor();
  step("brand kit: logo upload shows preview", true);
  await page.getByLabel("Ana renk", { exact: true }).fill("#0a7f5a");
  await page.getByLabel("Buton rengi", { exact: true }).fill("#0a7f5a");
  await page.getByLabel("Alt bilgi metni").fill("Acme A.Ş.\nÇankaya, Ankara");
  await page.getByRole("button", { name: "Marka kitini kaydet" }).click();
  await page.getByText("Marka kiti kaydedildi.").waitFor();
  step("brand kit: save", true);
  const logoSrc = await page.getByAltText("Mevcut logo").getAttribute("src");
  const logoRes = await page.request.get(`${BASE}${logoSrc}`);
  step(
    "public /a/<id> serves the image with hardened headers",
    logoRes.status() === 200 &&
      logoRes.headers()["content-type"] === "image/png" &&
      logoRes.headers()["x-content-type-options"] === "nosniff" &&
      /sandbox/.test(logoRes.headers()["content-security-policy"] || ""),
  );
  const bad = await page.request.get(`${BASE}/a/not-a-uuid`);
  step("public /a/<bad id> is 404", bad.status() === 404);
  const svgRes = await page.request.post(`${BASE}/api/assets`, {
    headers: { Origin: BASE },
    multipart: {
      file: {
        name: "x.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
        ),
      },
    },
  });
  step("SVG disguised as .png is rejected by the API", svgRes.status() === 400);

  // ---------------------------------------------------------------- library gallery
  await page.goto(`${BASE}/templates?tab=library`);
  await page.getByRole("heading", { name: "Etkinlik duyurusu" }).waitFor();
  const cards = await page.locator("ul li h3").count();
  step("library gallery lists 8 templates", cards === 8, `${cards} cards`);
  const frame = page
    .frames()
    .find((f) => f.url().includes("/library/newsletter/preview"));
  await page.waitForTimeout(800);
  const thumb = frame
    ? await frame
        .locator("body")
        .innerText()
        .catch(() => "")
    : "";
  step(
    "gallery thumbnail renders the template in the brand (sandboxed iframe)",
    /Bu ayın öne çıkanları/.test(thumb),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-library.png`, fullPage: true });

  await page
    .locator("li", { hasText: "Etkinlik duyurusu" })
    .getByRole("button", { name: "Bu şablonla başla" })
    .click();
  await page.getByLabel("Şablon adı").last().fill("Haziran Etkinliği");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/);
  step("start from library → editor opens", true);
  const templateUrl = page.url();

  // ---------------------------------------------------------------- editor basics
  const canvas = page.getByRole("region", { name: "E-posta tuvali" });
  await canvas.getByText("Sizi etkinliğimize davet ediyoruz").waitFor();
  step(
    "canvas shows the branded library content (logo block first)",
    (await canvas.locator("img").first().getAttribute("src"))?.startsWith("/a/") ===
      true,
  );
  const blockButtons = () => canvas.getByRole("button", { name: /bloğunu seç$/ });
  const order = async () =>
    (await blockButtons().allInnerTexts()).map((t) => t.split("\n")[0].slice(0, 28));

  // edit text; focus must survive typing
  await canvas.getByText("Sizi etkinliğimize davet ediyoruz").click();
  const textArea = page.getByLabel("Metin", { exact: true });
  await textArea.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Yeni başlık metni", { delay: 25 });
  step(
    "inspector keeps focus while typing; canvas updates live",
    (await textArea.inputValue()) === "Yeni başlık metni" &&
      (await canvas.getByText("Yeni başlık metni").count()) === 1,
  );

  // merge field via picker, unknown field warning
  await canvas
    .getByText(/Merhaba Ayşe/)
    .first()
    .click();
  const para = page.getByLabel("Metin", { exact: true });
  await para.click();
  await page.keyboard.press("Control+End");
  await page.getByLabel("Kişiselleştirme alanı ekle").selectOption({ label: "Şirket" });
  step(
    "merge-field picker inserts {{company}} at the caret",
    /\{\{company\}\}$/.test(await para.inputValue()),
  );
  await page.keyboard.type(" {{bogus}}");
  await page
    .getByRole("list", { name: "Uyarılar" })
    .getByText(/Bilinmeyen kişiselleştirme alanı: \{\{bogus\}\}/)
    .waitFor();
  step("unknown merge field is flagged immediately", true);

  // add a block from the palette (click), then undo it
  const countBefore = await blockButtons().count();
  await page.getByRole("button", { name: "Ayırıcı" }).click();
  step(
    "palette click adds a block",
    (await blockButtons().count()) === countBefore + 1,
  );
  await page.getByRole("button", { name: "Geri al" }).click();
  step("undo removes it", (await blockButtons().count()) === countBefore);

  // palette drag-and-drop with the mouse
  const paletteItem = page.getByRole("button", { name: "Boşluk", exact: true });
  const target = blockButtons().nth(1);
  const pb = await paletteItem.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + 60, pb.y + 10, { steps: 6 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  step(
    "dragging a palette block onto the canvas inserts it",
    (await blockButtons().count()) === countBefore + 1,
  );
  await page.getByRole("button", { name: "Geri al" }).click();

  // reorder with the mouse (drag handle)
  const o0 = await order();
  const handle0 = canvas.getByRole("button", { name: /bloğunu sürükle/ }).first();
  await blockButtons().first().hover();
  const hb = await handle0.boundingBox();
  const second = await blockButtons().nth(2).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 8, hb.y + 12, { steps: 6 });
  await page.mouse.move(second.x + second.width / 2, second.y + second.height + 4, {
    steps: 16,
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const o1 = await order();
  step(
    "mouse drag reorders blocks",
    JSON.stringify(o0) !== JSON.stringify(o1) && o1.length === o0.length,
    `${o0[0]} → moved`,
  );
  await page.getByRole("button", { name: "Geri al" }).click();
  step(
    "undo restores the original order",
    JSON.stringify(await order()) === JSON.stringify(o0),
  );

  // keyboard reorder (accessibility): Space to lift, ArrowDown to move, Space to drop
  await blockButtons().first().click();
  const kh = canvas.getByRole("button", { name: /bloğunu sürükle/ }).first();
  await kh.focus();
  // dnd-kit attaches its keyboard listeners asynchronously; a human never presses keys within one frame.
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  step(
    "keyboard drag (Space/Arrow/Space) reorders blocks",
    JSON.stringify(await order()) !== JSON.stringify(o0),
  );
  await page.getByRole("button", { name: "Geri al" }).click();

  // ---------------------------------------------------------------- image block: upload + svg rejection
  await page.getByRole("button", { name: "Görsel", exact: true }).click();
  const imgPath = `${tmp}/e2e-photo.png`;
  fs.writeFileSync(imgPath, png(300, 120, [74, 63, 214]));
  const fileInput = page.locator('aside[aria-label="Özellikler"] input[type="file"]');
  await fileInput.setInputFiles(imgPath);
  await page.getByPlaceholder(/görsel adresi/).waitFor();
  await page.waitForFunction(() =>
    /^\/a\//.test(
      document.querySelector(
        'aside[aria-label="Özellikler"] input[placeholder^="veya"]',
      )?.value || "",
    ),
  );
  step(
    "image block: upload sets /a/<id> and shows in canvas",
    (await canvas.locator('img[src^="/a/"]').count()) >= 2,
  );
  const svgPath = `${tmp}/e2e-evil.svg`;
  fs.writeFileSync(
    svgPath,
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  );
  await fileInput.setInputFiles(svgPath);
  await page
    .getByRole("alert")
    .filter({ hasText: "Yalnızca PNG, JPEG, GIF veya WebP" })
    .waitFor();
  step("image block: SVG upload shows a clear rejection", true);

  // ---------------------------------------------------------------- HTML block: script must never survive
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await page
    .getByLabel("HTML", { exact: true })
    .fill(
      '<p onclick="alert(1)">güvenli</p><script>alert("xss")</script><img src=x onerror=alert(2)>',
    );

  // ---------------------------------------------------------------- save, reload, persistence
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.getByText("Sürüm 2 · kayıtlı").waitFor();
  step("save creates version 2", true);
  await page.reload();
  await canvas.getByText("Yeni başlık metni").waitFor();
  step(
    "changes persist after reload",
    (await canvas.locator('img[src^="/a/"]').count()) >= 2,
  );

  // ---------------------------------------------------------------- preview (server-rendered)
  await page.getByRole("tab", { name: "Önizleme" }).click();
  const iframe = page.frameLocator('iframe[title="E-posta önizlemesi"]');
  await iframe.getByText("Yeni başlık metni").waitFor();
  const prevHtml = await page
    .locator('iframe[title="E-posta önizlemesi"]')
    .getAttribute("srcdoc");
  step(
    "preview is personalized with a sample contact",
    /Merhaba Ayşe/.test(await iframe.locator("body").innerText()),
  );
  step(
    "preview contains NO script, handler or raw <img onerror>",
    !/<script/i.test(prevHtml) &&
      !/onerror\s*=/i.test(prevHtml) &&
      !/onclick\s*=/i.test(prevHtml) &&
      /güvenli/.test(prevHtml),
  );
  step(
    "preview has an unsubscribe link and the brand logo as an absolute URL",
    /Abonelikten çık/.test(prevHtml) &&
      new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/a/[0-9a-f-]{36}`).test(
        prevHtml,
      ),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-preview-desktop.png` });
  await page.getByRole("button", { name: "Mobil" }).click();
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-preview-mobile.png` });
  const width = await page
    .locator('iframe[title="E-posta önizlemesi"]')
    .evaluate((el) => el.getBoundingClientRect().width);
  step(
    "mobile preview is 375px wide",
    Math.round(width) === 375,
    `${Math.round(width)}px`,
  );
  await page.getByRole("button", { name: "Düz metin sürümünü göster" }).click();
  step(
    "plain-text alternative is available",
    /Abonelikten çık:/.test(
      await page.locator("pre", { hasText: "Abonelikten çık:" }).first().innerText(),
    ),
  );
  await page.getByRole("tab", { name: "Düzenle" }).click();

  // ---------------------------------------------------------------- versions
  await page.getByRole("button", { name: "Sürümler" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Sürüm 2 (güncel)").waitFor();
  step(
    "version history lists both versions",
    (await dialog.getByText(/^Sürüm \d/).count()) === 2,
  );
  await dialog
    .locator("li", { hasText: "Sürüm 1" })
    .getByRole("button", { name: "Geri yükle" })
    .click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "geri yüklensin mi?" })
    .getByRole("button", { name: "Geri yükle" })
    .click();
  await page.getByText(/Sürüm geri yüklendi \(yeni sürüm: 3\)/).waitFor();
  step(
    "restoring v1 appends v3 and reverts content",
    (await canvas.getByText("Sizi etkinliğimize davet ediyoruz").count()) === 1 &&
      (await canvas.getByText("Yeni başlık metni").count()) === 0,
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/13-editor.png` });

  // ---------------------------------------------------------------- list actions
  await page.goto(`${BASE}/templates`);
  await page.getByText("Haziran Etkinliği").waitFor();
  await page.getByRole("button", { name: "Kopyala" }).first().click();
  await page.getByLabel("Şablon adı").last().fill("Haziran Etkinliği (kopya)");
  await page.getByRole("button", { name: "Kopyala" }).last().click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/);
  step("duplicate template opens the copy", true);
  await page.goto(`${BASE}/templates`);
  await page
    .locator("li", { hasText: "(kopya)" })
    .getByRole("button", { name: "Arşivle" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Arşivle" }).click();
  await page.waitForTimeout(600);
  step(
    "archive removes it from the list",
    (await page.getByText("(kopya)").count()) === 0,
  );
  await page.goto(`${BASE}/templates?tab=archive`);
  step("…and it appears under Arşiv", (await page.getByText("(kopya)").count()) === 1);

  // ---------------------------------------------------------------- tenant isolation in the browser
  const foreignId = psql(
    `select t.id from templates t where t.organization_id <> '${orgId()}' limit 1`,
  );
  if (foreignId) {
    const res = await page.goto(`${BASE}/templates/${foreignId}`);
    step("another organization's template id is a 404 page", res.status() === 404);
  }

  // ---------------------------------------------------------------- mobile editor
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "tr-TR",
    storageState: await context.storageState(),
  });
  const mp = await mobile.newPage();
  mp.on("pageerror", (e) =>
    problems.push(`mobile pageerror: ${e.message.slice(0, 200)}`),
  );
  await mp.goto(templateUrl);
  await mp.getByRole("region", { name: "E-posta tuvali" }).waitFor();
  const overflow = await mp.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step("mobile: editor has no page-level horizontal scroll", !overflow);
  if (SHOTS)
    await mp.screenshot({ path: `${SHOTS}/14-editor-mobile.png`, fullPage: false });

  // Two failures are provoked on purpose above (SVG upload → 400; a foreign tenant's template → 404). Each
  // produces one HTTP line (with its URL) plus one anonymous "Failed to load resource" console line.
  const intentional = problems.filter((p) =>
    /^HTTP 400 \/api\/assets|^HTTP 404 \/templates\//.test(p),
  );
  let anonymousToDrop = intentional.length;
  const unexpected = problems.filter((p) => {
    if (intentional.includes(p)) return false;
    if (anonymousToDrop > 0 && /Failed to load resource/.test(p)) {
      anonymousToDrop--;
      return false;
    }
    return true;
  });
  step(
    "no unexpected console errors / page errors / 4xx-5xx / alert dialogs",
    unexpected.length === 0,
    unexpected.slice(0, 6).join(" | "),
  );
  await browser.close();
  process.exit(finish(unexpected));
})().catch((e) => {
  console.error("SCRIPT ERROR", e.message.split("\n").slice(0, 8).join("\n"));
  process.exit(2);
});
