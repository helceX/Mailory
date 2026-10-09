import Link from "next/link";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { AcceptInviteButton } from "@/components/accept-invite-button";
import { getOrgContext } from "@/lib/org/context";

export const metadata = { title: "Daveti kabul et" };
export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const context = await getOrgContext();
  if (!token) {
    return (
      <AuthCard title="Davet">
        <FormError message="Davet bağlantısı eksik veya geçersiz." />
      </AuthCard>
    );
  }
  if (!context) {
    return (
      <AuthCard
        title="Davet edildiniz"
        description="Daveti kabul etmek için önce davetin gönderildiği e-posta adresiyle giriş yapın veya kayıt olun, ardından bu bağlantıya tekrar tıklayın."
      >
        <div className="flex flex-col gap-3 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Giriş yap
          </Link>
          <Link href="/register" className="text-primary hover:underline">
            Kayıt ol
          </Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Daveti kabul et"
      description={`${context.user.email} olarak giriş yaptınız.`}
    >
      <AcceptInviteButton token={token} />
    </AuthCard>
  );
}
