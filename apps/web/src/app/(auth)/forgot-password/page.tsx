import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Parolamı unuttum" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Parolamı unuttum"
      description="E-posta adresinizi girin, size bir sıfırlama bağlantısı gönderelim."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Girişe dön
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
