import { DomainCheckForm } from "@/components/public/domain-check-form";

export const metadata = {
  title: "Ücretsiz alan adı e-posta sağlık raporu",
  description:
    "SPF, DKIM, DMARC ve MX kayıtlarınızı kontrol edin; e-postalarınızın neden spama düştüğünü ve ne yapmanız gerektiğini görün.",
};

export default function DomainCheckPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Alan adı e-posta sağlık raporu
        </h1>
        <p className="mt-2 text-muted-foreground">
          E-postalarınızın gelen kutusuna ulaşması için alan adınızın SPF, DKIM ve DMARC
          kayıtları doğru olmalı. Alan adınızı girin; ne eksik, neden önemli ve tam
          olarak ne yapmanız gerektiğini söyleyelim. Giriş gerekmez, yalnızca herkese
          açık DNS kayıtlarına bakılır.
        </p>
      </header>
      <DomainCheckForm />
      <footer className="text-xs text-muted-foreground">
        DKIM seçicisi dışarıdan bilinemediği için yalnızca yaygın seçicilere bakılır;
        özel bir seçici kullanıyorsanız “bulunamadı” görebilirsiniz.
      </footer>
    </main>
  );
}
