import Link from "next/link";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Yeni parola belirle" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthCard
      title="Yeni parola belirle"
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Girişe dön
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <FormError message="Bağlantı eksik veya geçersiz." />
      )}
    </AuthCard>
  );
}
