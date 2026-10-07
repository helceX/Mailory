/*
 * Browser e2e for automations: build a flow in the UI, start it, let a real worker enrol a new contact and send the
 * first email, then pause/resume. Run against `next dev` (see sending.e2e.cjs for the setup).
 */
const { spawn } = require("node:child_process");
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SECRET = process.env.SESSION_SECRET || "a".repeat(64);
const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Otomasyon Test Şirketi");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const call = (path, method, body) =>
    page.request.fetch(`${BASE}${path}`, { method, headers, data: body });

  const domain = `auto-${Date.now()}.com`;
  psql(
    `insert into sender_domains(organization_id,domain,status,provider,dkim_tokens,ownership_token,verified_at) values('${orgId}','${domain}','verified','mock',to_jsonb(array['a','b','c']),'${"o".repeat(32)}',now())`,
  );
  await call("/api/sender-identities", "POST", {
    fromName: "Acme",
    fromEmail: `info@${domain}`,
    replyTo: "",
  });
  await call("/api/templates", "POST", {
    name: "Karşılama şablonu",
    category: "newsletter",
  });
  psql(
    `insert into contacts(organization_id,email,status,consent_status) values('${orgId}','eski-${Date.now()}@example.org','subscribed','granted')`,
  );

  await page.goto(`${BASE}/automations`);
  await page.getByText("Henüz otomasyonunuz yok.").waitFor();
  step("automations: empty state", true);
  await page.getByRole("button", { name: "Yeni otomasyon" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Karşılama serisi");
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.waitForURL(/automations\/[0-9a-f-]{36}/);
  const id = page.url().split("/").pop();
  step("create opens the builder", true);

  const startBtn = page.getByRole("button", { name: "Başlat", exact: true });
  step("start is disabled for an empty flow", await startBtn.isDisabled());
  await page.getByRole("button", { name: "E-posta", exact: true }).click();
  await page
    .getByLabel("Konu", { exact: true })
    .fill("Hoş geldiniz {{first_name|dost}}");
  await page.getByRole("button", { name: "Bekle", exact: true }).click();
  await page.getByRole("button", { name: "E-posta", exact: true }).click();
  await page.getByLabel("Konu", { exact: true }).last().fill("İkinci e-posta");
  if (SHOTS)
    await page.screenshot({ path: `${SHOTS}/automation-builder.png`, fullPage: true });
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByText("Kaydedildi.").waitFor();
  step(
    "flow saved (email → wait → email)",
    psql(`select jsonb_array_length(steps) from automations where id='${id}'`) === "3",
  );
  await startBtn.waitFor();
  await page.waitForFunction(
    () => !document.querySelector("button[disabled]")?.textContent?.includes("Başlat"),
    null,
    { timeout: 10_000 },
  );
  await startBtn.click();
  await page.getByRole("button", { name: "Başlat", exact: true }).last().click();
  await page.getByText("Etkin").first().waitFor();
  step(
    "starting activates and freezes the automation",
    psql(`select status from automations where id='${id}'`) === "active",
  );
  step(
    "hidden step campaigns were created (2)",
    psql(
      `select count(*) from campaigns where automation_id='${id}' and kind='automation_step'`,
    ) === "2",
  );
  const hidden = await call("/api/campaigns", "GET");
  step(
    "hidden campaigns stay out of the campaign list",
    !JSON.stringify(await hidden.json()).includes("automation_step"),
  );

  // A contact who appears AFTER activation is enrolled; the pre-existing one is not.
  const worker = spawn(
    "pnpm",
    ["--filter", "@mailory/worker", "exec", "tsx", "src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_URL: BASE,
        SESSION_SECRET: SECRET,
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgres://mailory:mailory@localhost:5432/mailory",
        REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
        EMAIL_PROVIDER: "console",
        SEND_RATE_PER_SECOND: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  worker.stdout.on("data", (d) => (log += d));
  worker.stderr.on("data", (d) => (log += d));
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const fresh = `yeni-${Date.now()}@example.org`;
    psql(
      `insert into contacts(organization_id,email,first_name,status,consent_status) values('${orgId}','${fresh}','Ayşe','subscribed','granted')`,
    );
    await page.goto(`${BASE}/automations/${id}`);
    await page
      .waitForFunction(() => /Akışta:\s*1/.test(document.body.innerText), null, {
        timeout: 90_000,
      })
      .catch(() => {});
    const deadline = Date.now() + 90_000;
    let sent = "0";
    while (Date.now() < deadline) {
      sent = psql(
        `select count(*) from campaign_recipients r join campaigns c on c.id=r.campaign_id where c.automation_id='${id}' and r.status='sent'`,
      );
      if (sent === "1") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    step(
      "the new contact got exactly the first email, sent by the normal engine",
      sent === "1",
      `sent=${sent}`,
    );
    step(
      "only the new contact was enrolled",
      psql(
        `select count(*) from automation_enrollments where automation_id='${id}'`,
      ) === "1",
    );
    step(
      "the enrolment waits on the wait step",
      psql(
        `select current_step_id is not null and status='active' from automation_enrollments where automation_id='${id}'`,
      ) === "t",
    );
    step(
      "the hidden step campaign is never completed",
      psql(
        `select count(*) from campaigns where automation_id='${id}' and status='completed'`,
      ) === "0",
    );
    await page.goto(`${BASE}/automations/${id}`);
    await page
      .getByText(/Gönderilen 1/)
      .first()
      .waitFor({ timeout: 20_000 });
    step("builder shows per-email stats", true);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/automation-running.png`,
        fullPage: true,
      });

    await page.getByRole("button", { name: "Duraklat", exact: true }).click();
    await page.getByText("Duraklatıldı").first().waitFor();
    step(
      "pause works",
      psql(`select status from automations where id='${id}'`) === "paused",
    );
    await page.getByRole("button", { name: "Devam ettir", exact: true }).click();
    await page.getByText("Etkin").first().waitFor();
    step(
      "resume works",
      psql(`select status from automations where id='${id}'`) === "active",
    );
    const locked = await call(`/api/automations/${id}`, "PATCH", { name: "değiştir" });
    step("a started automation cannot be edited (409)", locked.status() === 409);
  } finally {
    worker.kill("SIGTERM");
  }
  await browser.close();
  console.log("\n--- worker log (tail) ---\n" + log.split("\n").slice(-5).join("\n"));
  const unexpected = problems.filter(
    (p) => !/status of 409/.test(p) && !/HTTP 409/.test(p),
  );
  process.exit(finish(unexpected) || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
