import { limitMessage, can } from "@mailory/core";
import { PageHeader } from "@/components/page-header";
import {
  ApiKeysPanel,
  WebhooksPanel,
  type EndpointRow,
  type KeyRow,
} from "@/components/developers/developer-panels";
import { devDeps } from "@/lib/developers/deps";
import { developerOverviewFor } from "@/lib/developers/service";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Geliştiriciler" };
export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const context = (await getOrgContext())!;
  const actor = context.actor!;
  if (!can(actor.role, "api_keys:manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Geliştiriciler"
          description="API anahtarları ve webhook’lar."
        />
        <p className="text-sm text-muted-foreground">
          API anahtarlarını ve webhook’ları yalnızca yöneticiler ve sahipler
          yönetebilir.
        </p>
      </div>
    );
  }
  const r = await developerOverviewFor(devDeps(), actor);
  if (!r.ok) return null;
  const keys: KeyRow[] = r.keys.map((k) => ({
    ...k,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  }));
  const endpoints: EndpointRow[] = r.endpoints.map((e) => ({
    id: e.id,
    url: e.url,
    events: e.events,
    enabled: e.enabled,
    disabledReason: e.disabledReason,
    consecutiveFailures: e.consecutiveFailures,
  }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Geliştiriciler"
        description="API anahtarları ve webhook’lar ile Mailory’yi kendi sistemlerinize bağlayın. Belgeler: docs/MAILORY_API.md"
      />
      <p className="text-sm text-muted-foreground">
        Bu ayki API kullanımı: {r.quota.used.toLocaleString("tr-TR")} /{" "}
        {r.quota.limit === null ? "sınırsız" : r.quota.limit.toLocaleString("tr-TR")}
        {r.quota.limit === 0 ? " — planınız API erişimi içermiyor." : ""}
        {!r.quota.allowed && r.quota.limit !== 0 ? ` (${limitMessage(r.quota)})` : ""}
      </p>
      <ApiKeysPanel keys={keys} />
      <WebhooksPanel endpoints={endpoints} />
    </div>
  );
}
