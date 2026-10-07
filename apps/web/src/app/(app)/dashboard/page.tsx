import Link from "next/link";
import { Mail } from "lucide-react";
import { Button, EmptyState } from "@mailory/ui";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { getOrgContext } from "@/lib/org/context";
import { getDb } from "@/lib/db";
import { getOnboarding } from "@/lib/senders/service";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = (await getOrgContext())!.actor!;
  const onboarding = await getOnboarding({ db: getDb().db }, actor);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
      {onboarding.finished ? null : (
        <OnboardingChecklist
          steps={onboarding.steps}
          completed={onboarding.completed}
          total={onboarding.total}
        />
      )}
      <EmptyState
        icon={<Mail className="size-6" aria-hidden="true" />}
        title="Henüz kampanyanız bulunmuyor."
        description="İlk kampanyanızı oluşturduğunuzda performansınız burada görünür."
        action={
          <Button asChild variant="secondary">
            <Link href="/templates?tab=library">Şablonlara göz at</Link>
          </Button>
        }
      />
    </div>
  );
}
