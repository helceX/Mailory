/*
 * Browser e2e for the list-cleanup ("sunset") card on the Deliverability page.
 * Run against `next dev` (see automation.e2e.cjs for the setup).
 */
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Temizlik Test");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  psql(
    `insert into contacts (organization_id,email,status,consent_status,engagement_score,created_at)
       select '${orgId}','sessiz'||g||'@example.org','subscribed','granted',0,now()-interval '120 days' from generate_series(1,7) g`,
  );
  psql(
    `insert into contacts (organization_id,email,status,consent_status,engagement_score,created_at)
       select '${orgId}','aktif'||g||'@example.org','subscribed','granted',55,now()-interval '120 days' from generate_series(1,3) g`,
  );
  const usage = () =>
    psql(
      `select count(*) from contacts where organization_id='${orgId}' and status='subscribed'`,
    );

  await page.goto(`${BASE}/deliverability`);
  await page.getByRole("heading", { name: "Liste temizliği" }).waitFor();
  const card = page.locator("section[aria-labelledby=cleanup]");
  step(
    "the card counts the inactive people",
    (await card.innerText()).includes("7 etkisiz kişi"),
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/cleanup.png`, fullPage: true });

  await card.getByRole("button", { name: "Etkisizleri gönderimden çıkar" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Gönderimden çıkar" })
    .click();
  await card.getByText("7 kişi gönderimden çıkarıldı.").waitFor();
  step(
    "cleaning retires them without deleting anyone",
    psql(
      `select count(*) from contacts where organization_id='${orgId}' and status='cleaned'`,
    ) === "7" &&
      psql(`select count(*) from contacts where organization_id='${orgId}'`) === "10",
  );
  step("active contacts are untouched and the plan usage dropped", usage() === "3");
  await page.reload();
  step(
    "the card now shows 0 candidates and 7 cleaned",
    (await card.innerText()).includes("0 etkisiz kişi") &&
      (await card.innerText()).includes("7 temizlenmiş kişi"),
  );

  await card.getByRole("button", { name: "Temizlenenleri geri al" }).click();
  await card.getByText(/7 kişi geri alındı/).waitFor();
  step("restore brings them back as subscribers", usage() === "10");
  step(
    "both actions are audited",
    psql(
      `select count(*) from audit_logs where organization_id='${orgId}' and action in ('contacts.cleaned','contacts.cleaned_restored')`,
    ) === "2",
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
