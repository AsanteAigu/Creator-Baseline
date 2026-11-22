import { ChevronRight } from "lucide-react";
import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/** Shared page title block: optional breadcrumb, eyebrow, title, description and actions. */
export function PageHeader({
  crumbs,
  eyebrow,
  title,
  description,
  leading,
  actions,
}: {
  crumbs?: Crumb[];
  eyebrow?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
                {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 opacity-60" /> : null}
                {c.href ? (
                  <Link href={c.href} className="rounded-sm hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="truncate text-foreground">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</p>
            ) : null}
            <h1 className="mt-0.5 truncate font-display text-[28px] font-medium leading-tight tracking-tight sm:text-[32px]">
              {title}
            </h1>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
