import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { CreateOrgForm } from "@/components/create-org-form";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Organizasyon oluştur" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await getOrgContext();
  if (!context) redirect("/login");
  if (context.organization) redirect("/dashboard");
  return (
    <AuthCard
      title="Organizasyonunuzu oluşturun"
      description="Şirketiniz veya ekibiniz için bir çalışma alanı. Verileriniz diğer organizasyonlardan tamamen ayrıdır."
    >
      <CreateOrgForm />
    </AuthCard>
  );
}
