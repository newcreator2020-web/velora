import type { StaffSection } from "@/lib/server/content-engine";

export function StaffSectionComponent(section: StaffSection) {
  if (!section.data.members || section.data.members.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Il nostro team";
  return (
    <section aria-labelledby="site-staff-title" className="w-full py-16 px-6 bg-white">
      <div className="max-w-5xl mx-auto">
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-staff-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-10 break-words"
        >
          {headline}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {section.data.members.map((m, i) => (
            <li
              key={m.name + "-" + i}
              className="rounded-lg border border-border p-5 bg-background text-center"
            >
              {m.photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={m.photoUrl}
                  alt={m.name}
                  loading="lazy"
                  className="h-24 w-24 mx-auto rounded-full object-cover mb-3"
                />
              ) : (
                <div className="h-24 w-24 mx-auto rounded-full bg-muted mb-3" aria-hidden />
              )}
              <h3 className="text-lg font-semibold text-foreground break-words">{m.name}</h3>
              {m.role ? (
                <p className="text-sm text-muted-foreground break-words">{m.role}</p>
              ) : null}
              {m.bio ? (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words">
                  {m.bio}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
