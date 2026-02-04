import type { ReactNode } from "react";

export function SectionCard(
  { title, icon, children }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
  },
) {
  return (
    <section className="border border-border rounded-xl bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center space-x-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}
