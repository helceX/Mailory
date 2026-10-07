import { AuthCard, FormError } from "@/components/auth/auth-card";
import { VerifyEmailClient } from "@/components/auth/verify-email-client";

export const metadata = { title: "E-posta doğrulama" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthCard title="E-posta doğrulama">
      {token ? (
        <VerifyEmailClient token={token} />
      ) : (
        <FormError message="Bağlantı eksik veya geçersiz." />
      )}
    </AuthCard>
  );
}
