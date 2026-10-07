import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Giriş yap" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Giriş yap"
      description="Mailory hesabınıza erişin."
      footer={
        <>
          Hesabınız yok mu?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Kayıt olun
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthCard>
  );
}
