import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/settings-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <SettingsTabs />
      {children}
    </div>
  );
}
