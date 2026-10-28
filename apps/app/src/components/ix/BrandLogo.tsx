import type { ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIxSession } from "./ix-auth";

export function BrandLogo({ className, alt = "", children }: { className?: string; alt?: string; children: ReactNode }) {
  const logoUrl = useIxSession().status?.brand.logoUrl;
  if (logoUrl === undefined) return children;
  return <img src={logoUrl} alt={alt} draggable={false} data-ix-brand-logo="" className={cn("object-contain", className)} />;
}
