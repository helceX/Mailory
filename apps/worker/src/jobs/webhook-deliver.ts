import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";
import { isPrivateAddress, signWebhook } from "@mailory/core";
import {
  asOrganizationId,
  claimWebhookDeliveries,
  completeWebhookDelivery,
  type Database,
} from "@mailory/db";

export const WEBHOOK_QUEUE = "webhook-deliver";
export const WEBHOOK_EVERY_MS = 10_000;
const TIMEOUT_MS = 8_000;
const BATCH = 50;
const PARALLEL = 10;

export type PostResult = {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
};
export type PostFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<PostResult>;

/**
 * POSTs a webhook with an SSRF guard that cannot be raced: the address is validated INSIDE the socket's DNS lookup, so
 * the connection goes to exactly the address that was checked (no check-then-resolve-again window for DNS rebinding).
 * Redirects are never followed and the response body is discarded.
 */
export function createPoster(options: { allowPrivate?: boolean } = {}): PostFn {
  return (rawUrl, body, headers) =>
    new Promise<PostResult>((resolve) => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return resolve({ ok: false, statusCode: null, error: "invalid url" });
      }
      // Node does not call `lookup` for IP-literal hosts, so those are checked here (names are checked in `lookup`).
      if (!options.allowPrivate && isPrivateAddress(url.hostname))
        return resolve({ ok: false, statusCode: null, error: "blocked address" });
      const lib = url.protocol === "https:" ? https : http;
      const lookup: net_Lookup = (hostname, opts, cb) => {
        dns.lookup(hostname, { ...opts, all: false }, (err, address, family) => {
          if (err) return cb(err, "", 4);
          if (!options.allowPrivate && isPrivateAddress(address)) {
            return cb(new Error("blocked address"), "", 4);
          }
          cb(null, address, family);
        });
      };
      const req = lib.request(
        url,
        {
          method: "POST",
          headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
          timeout: TIMEOUT_MS,
          lookup: lookup as never,
        },
        (res) => {
          res.resume(); // discard the body
          const code = res.statusCode ?? 0;
          resolve({
            ok: code >= 200 && code < 300,
            statusCode: code,
            error: code >= 200 && code < 300 ? null : `HTTP ${code}`,
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) =>
        resolve({ ok: false, statusCode: null, error: e.message.slice(0, 200) }),
      );
      req.end(body);
    });
}
type net_Lookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: Error | null, address: string, family: number) => void,
) => void;

export type DeliverDeps = {
  db: Database;
  post: PostFn;
  now?: () => Date;
  scope?: { organizationId?: string };
};

/** One pass: lease due deliveries, send them (bounded parallelism), record each outcome. */
export async function deliverDue(deps: DeliverDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const due = await claimWebhookDeliveries(deps.db, BATCH, now, deps.scope);
  let delivered = 0;
  let failed = 0;
  const queue = [...due];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const body = JSON.stringify(d.payload);
      const result = await deps.post(d.url, body, {
        "Content-Type": "application/json",
        "User-Agent": "Mailory-Webhooks/1",
        "Mailory-Event": d.event_type,
        "Mailory-Delivery": d.id,
        "Mailory-Signature": signWebhook(d.secret, body, now),
      });
      await completeWebhookDelivery(
        deps.db,
        asOrganizationId(d.organization_id),
        d.id,
        result,
        (deps.now ?? (() => new Date()))(),
      );
      if (result.ok) delivered++;
      else failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, worker));
  return { claimed: due.length, delivered, failed };
}

/** Polls for due deliveries every few seconds; retries and backoff live in the database rows. */
export async function startWebhookDelivery(options: {
  redis: Redis;
  db: Database;
  allowPrivate?: boolean;
  everyMs?: number;
  log?: (message: string, data?: unknown) => void;
}) {
  const dup = () =>
    options.redis.duplicate({
      maxRetriesPerRequest: null,
    }) as unknown as ConnectionOptions;
  const queue = new Queue(WEBHOOK_QUEUE, { connection: dup() });
  await queue.upsertJobScheduler(
    "webhook-poll",
    { every: options.everyMs ?? WEBHOOK_EVERY_MS },
    { name: "poll", opts: { removeOnComplete: 5, removeOnFail: 20 } },
  );
  const post = createPoster({ allowPrivate: options.allowPrivate });
  const worker = new Worker(
    WEBHOOK_QUEUE,
    async () => {
      const result = await deliverDue({ db: options.db, post });
      if (result.claimed > 0) options.log?.("webhooks delivered", result);
      return result;
    },
    { connection: dup(), concurrency: 1 },
  );
  worker.on("failed", (job, error) =>
    console.error(`[worker] webhook ${job?.id} failed`, error),
  );
  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
