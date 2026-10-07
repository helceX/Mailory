"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy } from "lucide-react";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEvent,
} from "@mailory/core/shared";
import { Badge, Button, ConfirmDialog, Field, Input, NativeSelect } from "@mailory/ui";
import { FormError } from "../auth/auth-card";
import { apiCall } from "../audience/labels";

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
    : "—";

function useAct() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await apiCall(url, method, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return null;
    }
    router.refresh();
    return r.data;
  }
  return { error, busy, run };
}

/** A secret that is displayed once, right after creation. */
function ShownOnce({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3"
    >
      <p className="text-sm font-medium">
        {label} — bunu şimdi kopyalayın; bir daha gösterilmeyecek.
      </p>
      <code
        className="break-all rounded bg-surface px-2 py-1 text-xs"
        data-testid="shown-once"
      >
        {value}
      </code>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden="true" />{" "}
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Kopyaladım, kapat
        </Button>
      </div>
    </div>
  );
}

export type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function ApiKeysPanel({ keys }: { keys: KeyRow[] }) {
  const { error, busy, run } = useAct();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [created, setCreated] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="keys"
      className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
    >
      <div>
        <h2 id="keys" className="text-sm font-semibold">
          API anahtarları
        </h2>
        <p className="text-xs text-muted-foreground">
          Anahtarı <code>Authorization: Bearer …</code> başlığıyla gönderin. “Okuma”
          anahtarı yalnızca veri okur; “Yazma” kişi ekleyebilir ve bastırma listesine
          adres ekleyebilir. Gönderim ve silme API’den yapılamaz.
        </p>
      </div>
      {created ? (
        <ShownOnce
          label="API anahtarınız"
          value={created}
          onDone={() => setCreated(null)}
        />
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = (await run("/api/developers/keys", "POST", { name, scope })) as {
            key?: string;
          } | null;
          if (data?.key) {
            setCreated(data.key);
            setName("");
          }
        }}
      >
        <Field id="key-name" label="Ad">
          <Input
            id="key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder="Örn. Web sitesi formu"
          />
        </Field>
        <Field id="key-scope" label="Yetki">
          <NativeSelect
            id="key-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="read">Okuma</option>
            <option value="write">Yazma</option>
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>
          Anahtar oluştur
        </Button>
      </form>
      <FormError message={error} />
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz anahtar yok.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-medium">{k.name}</span>{" "}
                <code className="text-xs text-muted-foreground">mlk_{k.prefix}_…</code>{" "}
                <Badge tone={k.scope === "write" ? "warning" : "neutral"}>
                  {k.scope === "write" ? "Yazma" : "Okuma"}
                </Badge>{" "}
                {k.revokedAt ? <Badge tone="danger">İptal edildi</Badge> : null}
                <span className="block text-xs text-muted-foreground">
                  Oluşturuldu {fmt(k.createdAt)} · Son kullanım {fmt(k.lastUsedAt)}
                </span>
              </span>
              {k.revokedAt ? null : (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" className="text-danger">
                      İptal et
                    </Button>
                  }
                  title="Anahtar iptal edilsin mi?"
                  description="Bu anahtarı kullanan tüm entegrasyonlar hemen çalışmayı durdurur. Geri alınamaz."
                  confirmLabel="İptal et"
                  onConfirm={async () =>
                    void (await run(`/api/developers/keys/${k.id}`, "DELETE"))
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type EndpointRow = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
};
type Delivery = {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
};

function DeliveryLog({ id }: { id: string }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const r = await apiCall(`/api/developers/webhooks/${id}/deliveries`, "GET");
    if (!r.ok) return setError(r.message);
    setRows((r.data as { deliveries: Delivery[] }).deliveries);
  }
  return (
    <div className="mt-2">
      <Button variant="ghost" onClick={load}>
        Son teslimatlar
      </Button>
      <FormError message={error} />
      {rows ? (
        rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Henüz teslimat yok.</p>
        ) : (
          <table className="mt-1 w-full text-xs">
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="py-1">{fmt(d.createdAt)}</td>
                  <td>{d.eventType}</td>
                  <td>
                    <Badge
                      tone={
                        d.status === "delivered"
                          ? "success"
                          : d.status === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {d.status === "delivered"
                        ? "Teslim edildi"
                        : d.status === "failed"
                          ? "Başarısız"
                          : "Bekliyor"}
                    </Badge>
                  </td>
                  <td>{d.lastStatusCode ?? d.lastError ?? ""}</td>
                  <td>{d.attempts}. deneme</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}

export function WebhooksPanel({ endpoints }: { endpoints: EndpointRow[] }) {
  const { error, busy, run } = useAct();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([
    "email.bounced",
    "email.complained",
    "email.unsubscribed",
  ]);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="hooks"
      className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
    >
      <div>
        <h2 id="hooks" className="text-sm font-semibold">
          Webhook’lar
        </h2>
        <p className="text-xs text-muted-foreground">
          Seçtiğiniz olaylar gerçekleştiğinde adresinize imzalı bir JSON isteği
          gönderilir. İmza başlığı
          <code> Mailory-Signature: t=…,v1=… </code> biçimindedir (HMAC-SHA256,{" "}
          <code>t.gövde</code>). Başarısız teslimatlar artan aralıklarla tekrar denenir.
        </p>
      </div>
      {secret ? (
        <ShownOnce label="İmza sırrı" value={secret} onDone={() => setSecret(null)} />
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = (await run("/api/developers/webhooks", "POST", {
            url,
            events,
          })) as { secret?: string } | null;
          if (data?.secret) {
            setSecret(data.secret);
            setUrl("");
          }
        }}
      >
        <Field id="hook-url" label="Adres (https)">
          <Input
            id="hook-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://ornek.com/mailory-webhook"
          />
        </Field>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-sm font-medium">Olaylar</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents(
                    e.target.checked ? [...events, ev] : events.filter((x) => x !== ev),
                  )
                }
              />
              {WEBHOOK_EVENT_LABELS[ev]}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={busy || !url || events.length === 0}>
            Webhook ekle
          </Button>
        </div>
      </form>
      <FormError message={error} />
      {endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz webhook yok.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {endpoints.map((w) => (
            <li key={w.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="break-all font-medium">{w.url}</span>{" "}
                  {w.enabled ? (
                    <Badge tone="success">Etkin</Badge>
                  ) : (
                    <Badge tone="danger">Kapalı</Badge>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {w.events.join(", ")}
                  </span>
                  {w.disabledReason ? (
                    <span className="block text-xs text-danger">
                      {w.disabledReason}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Button
                    variant="secondary"
                    disabled={busy || !w.enabled}
                    onClick={() =>
                      void run(`/api/developers/webhooks/${w.id}/test`, "POST")
                    }
                  >
                    Test gönder
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(`/api/developers/webhooks/${w.id}`, "PATCH", {
                        enabled: !w.enabled,
                      })
                    }
                  >
                    {w.enabled ? "Kapat" : "Etkinleştir"}
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" className="text-danger">
                        Sil
                      </Button>
                    }
                    title="Webhook silinsin mi?"
                    description="Bekleyen teslimatlar da silinir."
                    confirmLabel="Sil"
                    onConfirm={async () =>
                      void (await run(`/api/developers/webhooks/${w.id}`, "DELETE"))
                    }
                  />
                </span>
              </div>
              <DeliveryLog id={w.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
