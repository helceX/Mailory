/*
 * Browser e2e for the send engine: a real worker process delivers a scheduled campaign (console transport), progress
 * shows in the UI, and the unsubscribe link/page/one-click work. Run against `next dev` started with
 * SESSION_SECRET=<64 'a'> (the e2e signs unsubscribe tokens with the same secret).
 */
const { spawn } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { BASE, psql, makeSteps, launch, signUpWithOrg } = require("./lib.cjs");

const SECRET = process.env.SESSION_SECRET || "a".repeat(64);
const SHOTS = process.env.SHOTS;
const { step, finish } = makeSteps();
const headers = { "Content-Type": "application/json", Origin: BASE };

// Mirrors packages/core/src/signed-token.ts (purpose "unsubscribe").
function unsubscribeToken(orgId, recipientId) {
  const body = Buffer.from(JSON.stringify([orgId, recipientId])).toString("base64url");
  const key = createHmac("sha256", SECRET)
    .update("mailory:token:v1:unsubscribe")
    .digest();
  return `${body}.${createHmac("sha256", key).update(body).digest().toString("base64url")}`;
}

(async () => {
  const { browser, page, problems } = await launch();
  const email = await signUpWithOrg(page, "Gönderim Test Şirketi");
  const orgId = psql(
    `select m.organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'`,
  );
  const call = (path, method, body) =>
    page.request.fetch(`${BASE}${path}`, { method, headers, data: body });

  const domain = `send-${Date.now()}.com`;
  psql(
    `insert into sender_domains(organization_id,domain,status,provider,dkim_tokens,ownership_token,verified_at) values('${orgId}','${domain}','verified','mock',to_jsonb(array['a','b','c']),'${"o".repeat(32)}',now())`,
  );
  await call("/api/sender-identities", "POST", {
    fromName: "Acme",
    fromEmail: `info@${domain}`,
    replyTo: "",
  });
  const tpl = await (
    await call("/api/templates", "POST", { name: "Bülten", category: "newsletter" })
  ).json();
  const emails = [];
  for (let i = 0; i < 3; i++) {
    const e = `s${i}-${Date.now()}@example.org`;
    emails.push(e);
    psql(
      `insert into contacts(organization_id,email,status,consent_status,first_name) values('${orgId}','${e}','subscribed','granted','Ad${i}')`,
    );
  }

  const created = await (
    await call("/api/campaigns", "POST", { name: "Gönderim testi" })
  ).json();
  const id = created.id;
  const patch = await call(`/api/campaigns/${id}`, "PATCH", {
    subject: "Merhaba {{first_name|dost}}",
    templateId: tpl.id,
    audience: { kind: "all" },
  });
  step("campaign prepared via API", patch.status() === 200, String(patch.status()));
  const sched = await call(`/api/campaigns/${id}/schedule`, "POST", { sendAt: null });
  step("campaign scheduled for now", sched.status() === 200, String(sched.status()));

  // Real worker process, console transport.
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
    await page.goto(`${BASE}/campaigns/${id}`);
    await page.waitForFunction(() => /Tamamlandı/.test(document.body.innerText), null, {
      timeout: 60_000,
    });
    step("worker delivers the campaign and it shows Tamamlandı", true);
    const text = await page.locator("main").innerText();
    step(
      "progress shows 3 / 3 recipients processed",
      /3\s*\/\s*3/.test(text),
      text.match(/\d+\s*\/\s*\d+[^\n]*/)?.[0],
    );
    step(
      "all recipients are marked sent with a provider id",
      psql(
        `select count(*) from campaign_recipients where campaign_id='${id}' and status='sent' and provider_message_id is not null`,
      ) === "3",
    );
    if (SHOTS)
      await page.screenshot({ path: `${SHOTS}/campaign-sent.png`, fullPage: true });

    // ---- unsubscribe
    const [recId, recEmail] = psql(
      `select id||'|'||email from campaign_recipients where campaign_id='${id}' order by email limit 1`,
    ).split("|");
    const token = unsubscribeToken(orgId, recId);
    await page.goto(`${BASE}/unsubscribe/${token}`);
    await page.getByText("Abonelikten çık", { exact: true }).first().waitFor();
    const shown = await page.locator("main").innerText();
    step(
      "unsubscribe page masks the address",
      !shown.includes(recEmail) && /\*\*/.test(shown),
    );
    step(
      "visiting the link alone does not unsubscribe",
      psql(
        `select status from contacts where organization_id='${orgId}' and email='${recEmail}'`,
      ) === "subscribed",
    );
    await page.getByRole("button", { name: "Evet, abonelikten çık" }).click();
    await page.getByText("Abonelikten çıktınız").waitFor();
    step(
      "confirming unsubscribes the contact",
      psql(
        `select status from contacts where organization_id='${orgId}' and email='${recEmail}'`,
      ) === "unsubscribed",
    );
    step(
      "and adds a suppression",
      psql(
        `select count(*) from suppressions where organization_id='${orgId}' and email='${recEmail}' and reason='unsubscribe'`,
      ) === "1",
    );

    const oneClick = await fetch(`${BASE}/api/unsubscribe/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    step("RFC 8058 one-click POST works and is idempotent", oneClick.status === 200);
    const bad = await fetch(`${BASE}/api/unsubscribe/${token.slice(0, -3)}xyz`, {
      method: "POST",
    });
    step("a forged token is rejected", bad.status === 404);
    await page.goto(`${BASE}/unsubscribe/not-a-token`);
    await page.getByText("Bağlantı geçersiz").waitFor();
    step("an invalid link shows a clear message", true);

    // ---- the next campaign no longer counts the unsubscribed address
    const c2 = await (await call("/api/campaigns", "POST", { name: "İkinci" })).json();
    await call(`/api/campaigns/${c2.id}`, "PATCH", {
      subject: "Selam",
      templateId: tpl.id,
      audience: { kind: "all" },
    });
    const detail = await (await call(`/api/campaigns/${c2.id}`, "GET")).json();
    step(
      "next campaign audience excludes the unsubscribed address (2)",
      detail.audienceCount === 2,
      String(detail.audienceCount),
    );
  } finally {
    worker.kill("SIGTERM");
  }

  await browser.close();
  console.log("\n--- worker log (tail) ---\n" + log.split("\n").slice(-6).join("\n"));
  process.exit(
    finish(problems.filter((p) => !/status of (404)/.test(p) && !/HTTP 404/.test(p))) ||
      0,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
