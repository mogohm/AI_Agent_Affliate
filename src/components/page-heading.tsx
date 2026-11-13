import * as React from "react";

/** Section heading used at the top of each module page (prototype `.section-heading`). */
export function PageHeading({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row">
      <div className="min-w-0">
        <h2 className="mb-1 text-[23px] font-bold tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
