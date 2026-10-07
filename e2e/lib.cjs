/* Shared helpers for browser e2e scripts. Not run on its own. */
const { chromium } = require("playwright-core");
const { execSync } = require("node:child_process");
const zlib = require("node:zlib");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const DB =
  process.env.DATABASE_URL || "postgres://mailory:mailory@localhost:5432/mailory";
const psql = (q) => execSync(`psql ${DB} -tAc "${q}"`).toString().trim();

function makeSteps() {
  const log = [];
  return {
    log,
    step(name, ok, extra = "") {
      log.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
    },
    finish(problems) {
      const failed = log.filter((l) => !l.ok).length;
      console.log(
        `\n${log.length - failed}/${log.length} passed${problems.length ? `  (${problems.length} browser problems)` : ""}`,
      );
      return failed ? 1 : 0;
    },
  };
}

/** Real, valid PNG of a solid colour (so we exercise genuine signature checking, not a stub). */
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function launch(viewport = { width: 1400, height: 900 }) {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport, locale: "tr-TR" });
  const problems = [];
  const page = await context.newPage();
  page.on("console", (m) => {
    if (
      ["error", "warning"].includes(m.type()) &&
      !/Download the React DevTools/.test(m.text())
    )
      problems.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("dialog", (d) => {
    problems.push(`UNEXPECTED DIALOG: ${d.message()}`);
    d.dismiss();
  });
  context.on("response", (r) => {
    if (r.status() >= 400 && r.status() !== 401)
      problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`);
  });
  return { browser, context, page, problems };
}

/** Register + verify through the API, sign in through the real form, create an organization. */
async function signUpWithOrg(page, orgName) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  const headers = { "Content-Type": "application/json", Origin: BASE };
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: "a-strong-password-1",
      firstName: "E2E",
      lastName: "Tester",
    }),
  });
  const token = psql(
    `select body_text from email_outbox where to_email='${email}' and kind='verify_email'`,
  ).match(/token=(\S+)/)[1];
  await fetch(`${BASE}/api/auth/verify-email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill("a-strong-password-1");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByLabel("Organizasyon adı").fill(orgName);
  await page.getByRole("button", { name: "Organizasyon oluştur" }).click();
  await page.waitForURL(/dashboard/);
  return email;
}

module.exports = { BASE, psql, makeSteps, png, launch, signUpWithOrg };
