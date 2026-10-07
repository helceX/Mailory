import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata = { title: "Kayıt ol" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Hesap oluştur"
      description="Birkaç dakikada ilk kampanyanıza hazır olun."
      footer={
        <>
          Zaten hesabınız var mı?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Giriş yapın
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
