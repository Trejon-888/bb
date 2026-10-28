import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import type { IxBrand } from "../ix-auth";
import { useNexusRootAttribute } from "./nexus-root";
import { NexusBrandTile } from "./NexusSidebar";

const VALUE_POINTS = [
  "Ask in plain language and get finished work back.",
  "Connected to the tools your team already uses.",
  "Repeat work runs on a schedule and reports back.",
];

export function NexusSignInLayout({
  brand,
  title,
  subtitle,
  children,
}: {
  brand: IxBrand;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  useNexusRootAttribute();
  const appTitle = brand.appTitle ?? brand.name ?? "Nexus";
  const formTitle =
    brand.loginTitle !== undefined && title === brand.loginTitle
      ? "Welcome back"
      : title;
  const formSubtitle =
    brand.loginSubtitle !== undefined && subtitle === brand.loginSubtitle
      ? `Sign in to ${brand.name ?? appTitle}`
      : subtitle;
  return (
    <div
      className="grid min-h-dvh w-full bg-background font-sans text-foreground md:grid-cols-2"
      data-testid="nexus-sign-in"
    >
      <aside
        className="relative hidden flex-col overflow-hidden bg-(--nexus-story) px-9 pb-9 pt-7 text-(--nexus-story-foreground) md:flex"
        aria-label={`About ${appTitle}`}
      >
        <div className="flex items-center gap-2.5">
          <NexusBrandTile
            iconUrl={brand.iconUrl}
            label={appTitle}
            className="size-9"
          />
          <span className="text-xl font-bold tracking-tight text-(--nexus-story-foreground)">
            {appTitle}
          </span>
        </div>
        <div className="grid flex-1 place-items-center py-10">
          <div className="w-full max-w-md rounded-2xl bg-card p-8 text-card-foreground shadow-xl ring-8 ring-(--nexus-story-raised)">
            <p className="text-lg font-semibold leading-relaxed">
              {brand.loginTitle ??
                `${appTitle} is the teammate who never drops a thread.`}
            </p>
            {brand.loginSubtitle ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {brand.loginSubtitle}
              </p>
            ) : null}
            <hr className="my-5 border-border" />
            <ul className="flex flex-col gap-3">
              {VALUE_POINTS.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-3 text-sm leading-relaxed"
                >
                  <Icon
                    name="Check"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {brand.name && brand.name !== appTitle ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-(--nexus-story-muted)">
              Built by
            </span>
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="h-8 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span className="text-base font-bold text-(--nexus-story-foreground)">
                {brand.name}
              </span>
            )}
          </div>
        ) : null}
      </aside>
      <main className="flex flex-col items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center md:hidden">
            <NexusBrandTile
              iconUrl={brand.iconUrl}
              label={appTitle}
              className="size-10"
            />
          </div>
          <h1 className="text-center text-3xl font-bold tracking-tight">
            {formTitle}
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {formSubtitle}
          </p>
          <div className="mt-7">{children}</div>
          {brand.supportUrl !== undefined && (
            <a
              href={brand.supportUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-6 block text-center text-xs text-muted-foreground underline"
            >
              Need help?
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
