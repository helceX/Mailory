import type { ReactNode } from "react";
import { AudienceTabs } from "@/components/audience/audience-tabs";

export default function AudienceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <AudienceTabs />
      {children}
    </div>
  );
}
