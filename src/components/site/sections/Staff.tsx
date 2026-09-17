import Image from "next/image";
import type { StaffSection } from "@/lib/server/content-engine";

export function StaffSectionComponent(section: StaffSection) {
  if (!section.data.members || section.data.members.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Il nostro team";
  const variant = section.variant === "compact" ? "compact" : "cards";

  if (variant === "compact") {
    return (
      <section
        aria-labelledby="site-staff-title"
        data-section="staff"
        data-variant="compact"
        className="w-full py-12 md:py-16 px-6 bg-background"
      >
        <div className="max-w-5xl mx-auto">
          <div className="mb-8 md:mb-10 text-left">
            {eyebrow ? (
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-staff-title"
              className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
            {section.data.members.map((m, i) => (
              <li key={m.name + "-" + i} className="flex flex-col items-center text-center gap-2">
                {m.photoUrl ? (
                  <Image
                    src={m.photoUrl}
                    alt={m.name}
                    width={160}
                    height={160}
                    sizes="(max-width: 640px) 96px, 120px"
                    className="h-16 w-16 md:h-20 md:w-20 rounded-full object-cover ring-2 ring-border"
                    priority={false}
                    loading="lazy"
                  />
                ) : (
                  <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-muted" aria-hidden />
                )}
                <div className="min-w-0 w-full">
                  <h3 className="text-sm md:text-base font-medium text-foreground break-words truncate">
                    {m.name}
                  </h3>
                  {m.role ? (
                    <p className="text-xs text-muted-foreground break-words truncate">{m.role}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="site-staff-title"
      data-section="staff"
      data-variant="cards"
      className="w-full py-16 md:py-24 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 md:mb-14 text-center">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-staff-title"
            className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 break-words"
          >
            {headline}
          </h2>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
          {section.data.members.map((m, i) => (
            <li
              key={m.name + "-" + i}
              className="rounded-2xl border border-border p-6 md:p-7 bg-card text-center shadow-sm hover:shadow-md transition-all flex flex-col gap-4 items-center"
            >
              {m.photoUrl ? (
                <Image
                  src={m.photoUrl}
                  alt={m.name}
                  width={256}
                  height={256}
                  sizes="(max-width: 640px) 96px, 128px"
                  className="h-28 w-28 md:h-32 md:w-32 rounded-full object-cover ring-4 ring-primary/10"
                  priority={false}
                  loading="lazy"
                />
              ) : (
                <div className="h-28 w-28 md:h-32 md:w-32 rounded-full bg-muted mb-3" aria-hidden />
              )}
              <div className="flex flex-col gap-1.5 w-full">
                <h3 className="text-lg md:text-xl font-bold text-foreground break-words">
                  {m.name}
                </h3>
                {m.role ? (
                  <p className="text-sm font-medium text-primary break-words">{m.role}</p>
                ) : null}
                {m.bio ? (
                  <p className="text-sm md:text-[15px] text-muted-foreground mt-2 whitespace-pre-wrap break-words leading-relaxed">
                    {m.bio}
                  </p>
                ) : null}
              </div>
              <div className="mt-auto pt-4 w-full border-t border-border/50 flex flex-col items-center gap-2">
                <a
                  href="#booking"
                  className="btn btn-sm btn-outline w-full justify-center"
                  aria-label={`Prenota un appuntamento con ${m.name}`}
                >
                  Prenota con {m.name.split(/\s+/)[0]}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
