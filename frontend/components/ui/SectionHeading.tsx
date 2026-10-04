export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-600">
        <span className="h-px w-5 bg-gradient-to-r from-brand-600 to-transparent" aria-hidden />
        {eyebrow}
      </p>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
    </div>
  );
}
