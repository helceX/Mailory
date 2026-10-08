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

// Mirrors packages/core/src/signed-token.ts.
function signToken(purpose, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createHmac("sha256", SECRET)
    .update(`mailory:token:v1:${purpose}`)
    .digest();
  return `${body}.${createHmac("sha256", key).update(body).digest().toString("base64url")}`;
}
const unsubscribeToken = (orgId, recipientId) =>
  signToken("unsubscribe", [orgId, recipientId]);

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
  // Give the template an external link so there is something to track.
  const tplDoc = await (await call(`/api/templates/${tpl.id}`, "GET")).json();
  tplDoc.doc.blocks.splice(1, 0, {
    id: "btn-e2e",
    type: "button",
    label: "Alışverişe git",
    href: "https://shop.example.com/kampanya?a=1&b=2",
    variant: "solid",
    align: "center",
  });
  const saved = await call(`/api/templates/${tpl.id}`, "PUT", {
    doc: tplDoc.doc,
    expectedVersion: tplDoc.version,
  });
  step(
    "template gets an external link",
    saved.status() === 200,
    String(saved.status()),
  );
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

    // ---- tracking: wait out the scanner window, then click + open like a person would
    const linkRow = psql(
      `select id||'|'||url from campaign_links where campaign_id='${id}' limit 1`,
    );
    step(
      "a tracked link was registered for the campaign",
      linkRow.includes("shop.example.com") || linkRow.includes("http"),
      linkRow.slice(0, 80),
    );
    const [linkId, linkUrl] = linkRow.split("|");
    const [r0, r1] = psql(
      `select id from campaign_recipients where campaign_id='${id}' order by email limit 2`,
    ).split("\n");
    await new Promise((r) => setTimeout(r, 5000));
    const ua = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    };
    const click = await fetch(
      `${BASE}/c/${signToken("click", [orgId, id, r0, linkId])}`,
      { redirect: "manual", headers: ua },
    );
    step(
      "click link answers 302 to the stored destination",
      click.status === 302 && click.headers.get("location") === linkUrl,
      String(click.status),
    );
    const pixel = await fetch(`${BASE}/o/${signToken("open", [orgId, id, r1])}.gif`, {
      headers: ua,
    });
    step(
      "open pixel serves a no-store GIF",
      pixel.status === 200 &&
        pixel.headers.get("content-type") === "image/gif" &&
        /no-store/.test(pixel.headers.get("cache-control")),
    );
    const forged = await fetch(`${BASE}/o/garbage.gif`, { headers: ua });
    step(
      "a forged pixel token looks identical (no oracle)",
      forged.status === 200 && forged.headers.get("content-type") === "image/gif",
    );
    step(
      "forged click token is a 404, never a redirect",
      (await fetch(`${BASE}/c/garbage`, { redirect: "manual" })).status === 404,
    );
    const botClick = await fetch(
      `${BASE}/c/${signToken("click", [orgId, id, r1, linkId])}`,
      { redirect: "manual", headers: { "User-Agent": "python-requests/2.31" } },
    );
    step("a bot click still redirects", botClick.status === 302);
    step(
      "only genuine events counted: 1 click, 2 opens (click implies open)",
      psql(
        `select count(*) filter (where clicked_at is not null)||'/'||count(*) filter (where opened_at is not null) from campaign_recipients where campaign_id='${id}'`,
      ) === "1/2",
    );
    step(
      "bot hit is stored but flagged",
      psql(
        `select count(*) from tracking_events where campaign_id='${id}' and is_bot`,
      ) === "1",
    );
    step(
      "no raw IP or user agent is stored",
      psql(
        `select count(*) from tracking_events where campaign_id='${id}' and (ip_hash like '%.%' or device like 'Mozilla%')`,
      ) === "0",
    );

    const view = await fetch(`${BASE}/view/${signToken("view", [orgId, r0])}`);
    const viewHtml = await view.text();
    step(
      "view-in-browser serves the personalised email under a script-less CSP",
      view.status === 200 &&
        /default-src 'none'/.test(view.headers.get("content-security-policy")) &&
        viewHtml.includes("<html") &&
        !viewHtml.includes("/c/") &&
        !viewHtml.includes("/o/"),
    );
    step(
      "view-in-browser rejects a bad token",
      (await fetch(`${BASE}/view/nope`)).status === 404,
    );

    await page.goto(`${BASE}/campaigns/${id}`);
    await page.getByRole("heading", { name: "Performans" }).waitFor();
    const report = await page.locator("main").innerText();
    step(
      "campaign page shows the performance report with link table",
      /Gönderilen/.test(report) &&
        /En çok tıklanan/.test(report) &&
        report.includes("shop.example.com"),
    );
    // ---- outcomes: a conversion reported through the public API is attributed to the campaign the person clicked
    const crypto = require("node:crypto");
    const prefix = crypto.randomBytes(4).toString("hex");
    const secret = crypto.randomBytes(32).toString("base64url");
    const apiKey = `mlk_${prefix}_${secret}`;
    const userId = psql(
      `select user_id from memberships where organization_id='${orgId}' limit 1`,
    );
    psql(
      `insert into api_keys(organization_id,name,prefix,secret_hash,scope,created_by_user_id) values('${orgId}','e2e','${prefix}','${crypto.createHash("sha256").update(secret).digest("hex")}','write','${userId}')`,
    );
    psql(
      `insert into entitlement_overrides(organization_id,entitlement_key,limit_value,reason) values('${orgId}','api_requests',100,'e2e')`,
    );
    const clicker = psql(
      `select email from campaign_recipients where campaign_id='${id}' and clicked_at is not null limit 1`,
    );
    const conv = (body) =>
      fetch(`${BASE}/api/v1/conversions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const c1 = await conv({
      email: clicker,
      name: "purchase",
      value: 249.9,
      externalId: "order-1",
    });
    const c1b = await c1.json();
    step(
      "a conversion is attributed to the campaign the person clicked",
      c1.status === 201 && c1b.campaignId === id && c1b.attribution === "click",
    );
    const dup = await conv({
      email: clicker,
      name: "purchase",
      value: 249.9,
      externalId: "order-1",
    });
    step(
      "a retry with the same externalId does not double count",
      dup.status === 200 && (await dup.json()).duplicate === true,
    );
    const stranger = await (
      await conv({ email: "yabanci@example.org", name: "purchase", value: 10 })
    ).json();
    step(
      "an unknown person is stored but not attributed",
      stranger.campaignId === null,
    );
    step(
      "a bad payload is rejected (no identity)",
      (await conv({ name: "purchase" })).status === 400,
    );
    await page.goto(`${BASE}/campaigns/${id}`);
    await page.getByRole("heading", { name: "Sonuçlar" }).waitFor();
    const outcomeText = await page.locator("main").innerText();
    step(
      "the campaign report shows the outcome (people, value, click attribution)",
      /Dönüşen kişi/.test(outcomeText) &&
        /249,9/.test(outcomeText) &&
        /purchase/.test(outcomeText),
    );
    if (SHOTS)
      await page.screenshot({ path: `${SHOTS}/campaign-report.png`, fullPage: true });
    await page.goto(`${BASE}/analytics`);
    await page.getByText("Gönderim testi").first().waitFor();
    step("analytics page lists the campaign", true);
    const csv = await (await page.request.get(`${BASE}/api/analytics/export`)).text();
    step(
      "analytics CSV export contains the campaign",
      csv.includes("Gönderim testi") && csv.startsWith("\uFEFF"),
    );
    if (SHOTS)
      await page.screenshot({ path: `${SHOTS}/analytics.png`, fullPage: true });
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole("heading", { name: "Son 30 gün" }).waitFor();
    step("dashboard shows KPI tiles once there is data", true);

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
