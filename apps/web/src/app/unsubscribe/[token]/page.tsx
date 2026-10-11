import { lookupUnsubscribe } from "@mailory/sending";
import { UnsubscribeConfirm } from "@/components/unsubscribe-confirm";
import { sendingDeps } from "@/lib/sending-deps";

export const metadata = {
  title: "Abonelikten çık",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await lookupUnsubscribe(sendingDeps(), token);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      {found.ok ? (
        <UnsubscribeConfirm
          token={token}
          orgName={found.orgName}
          maskedEmail={found.maskedEmail}
        />
      ) : (
        <div className="rounded-lg border bg-surface p-6">
          <h1 className="text-lg font-semibold">Bağlantı geçersiz</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bu abonelikten çıkma bağlantısı geçersiz veya bozulmuş. E-postadaki
            bağlantıyı tam olarak kopyaladığınızdan emin olun.
          </p>
        </div>
      )}
    </main>
  );
}
