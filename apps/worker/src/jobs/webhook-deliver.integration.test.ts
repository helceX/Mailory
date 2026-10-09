import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature } from "@mailory/core";
import {
  asOrganizationId,
  createDb,
  createWebhookEndpoint,
  enqueueWebhookEvent,
  webhookDeliveries,
  type Database,
} from "@mailory/db";
import { createTestOrg, createTestUser } from "@mailory/db/testing";
import { createPoster, deliverDue } from "./webhook-deliver";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("webhook delivery (real Postgres + local HTTP receiver)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let server: http.Server;
  let port: number;
  let respond: (req: http.IncomingMessage) => number = () => 200;
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    const c = createDb(url!);
    db = c.db;
    end = () => c.pool.end();
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = respond(req);
        res.end("ignored body");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.close();
    await end();
  });

  async function setup() {
    const user = await createTestUser(db);
    const org = await createTestOrg(db, user.id);
    const oid = asOrganizationId(org.id);
    const ep = await createWebhookEndpoint(db, oid, {
      url: `http://127.0.0.1:${port}/hook`,
      secret: "whsec_test",
      events: ["email.clicked"],
      userId: user.id,
    });
    return { oid, ep };
  }

  it("delivers a signed JSON event the receiver can verify, then marks it delivered", async () => {
    const { oid, ep } = await setup();
    received.length = 0;
    respond = () => 200;
    await enqueueWebhookEvent(
      db,
      oid,
      "email.clicked",
      { email: "a@b.co" },
      new Date(),
    );
    const r = await deliverDue({
      db,
      post: createPoster({ allowPrivate: true }),
      scope: { organizationId: oid },
    });
    expect(r).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers["mailory-event"]).toBe("email.clicked");
    expect(headers["content-type"]).toBe("application/json");
    expect(
      verifyWebhookSignature("whsec_test", body, String(headers["mailory-signature"])),
    ).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      type: "email.clicked",
      data: { email: "a@b.co" },
    });
    const [d] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, ep.id));
    expect(d).toMatchObject({ status: "delivered", attempts: 1, lastStatusCode: 200 });
    expect(String(headers["mailory-delivery"])).toBe(d!.id);
  });

  it("a non-2xx response schedules a retry instead of dropping the event", async () => {
    const { oid, ep } = await setup();
    respond = () => 500;
    await enqueueWebhookEvent(db, oid, "email.clicked", {}, new Date());
    const r = await deliverDue({
      db,
      post: createPoster({ allowPrivate: true }),
      scope: { organizationId: oid },
    });
    expect(r).toMatchObject({ delivered: 0, failed: 1 });
    const [d] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, ep.id));
    expect(d).toMatchObject({ status: "pending", lastStatusCode: 500 });
    expect(d!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("never follows redirects (a 302 to an internal address is just a failure)", async () => {
    const { oid } = await setup();
    received.length = 0;
    respond = () => 302;
    await enqueueWebhookEvent(db, oid, "email.clicked", {}, new Date());
    const r = await deliverDue({
      db,
      post: createPoster({ allowPrivate: true }),
      scope: { organizationId: oid },
    });
    expect(r.failed).toBe(1);
    expect(received).toHaveLength(1); // only the original request
  });

  it("refuses private addresses unless explicitly allowed (SSRF guard sits inside the connection)", async () => {
    const post = createPoster({ allowPrivate: false });
    const blocked = await post(`http://127.0.0.1:${port}/hook`, "{}", {});
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/blocked/);
    const viaName = await post(`http://localhost:${port}/hook`, "{}", {});
    expect(viaName.ok).toBe(false);
  });

  it("times out nothing silently: connection errors become recorded failures", async () => {
    const post = createPoster({ allowPrivate: true });
    const r = await post("http://127.0.0.1:1/hook", "{}", {});
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toBeTruthy();
  });
});
