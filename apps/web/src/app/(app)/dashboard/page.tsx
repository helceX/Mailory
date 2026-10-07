import { Mail } from "lucide-react";
import { Button, EmptyState } from "@mailory/ui";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
      <EmptyState
        icon={<Mail className="size-6" aria-hidden="true" />}
        title="Henüz kampanyanız bulunmuyor."
        description="İlk kampanyanızı oluşturduğunuzda performansınız burada görünür."
        action={<Button disabled>+ Yeni Kampanya</Button>}
      />
    </div>
  );
}
