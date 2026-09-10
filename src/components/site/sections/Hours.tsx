import type { PublicSection, HoursSection, WeeklyHourRow } from "@/lib/server/content-engine";

export function HoursSectionComponent(s: PublicSection) {
  const sec = s as HoursSection;
  const variant = sec.variant === "compact" ? "compact" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Orari di Apertura";

  const defaultHours: WeeklyHourRow[] = [
    { day: "Lunedì", weekdayIndex: 0, enabled: true, start: "09:00", end: "19:00" },
    { day: "Martedì", weekdayIndex: 1, enabled: true, start: "09:00", end: "19:00" },
    { day: "Mercoledì", weekdayIndex: 2, enabled: true, start: "09:00", end: "19:00" },
    { day: "Giovedì", weekdayIndex: 3, enabled: true, start: "09:00", end: "19:00" },
    { day: "Venerdì", weekdayIndex: 4, enabled: true, start: "09:00", end: "19:00" },
    { day: "Sabato", weekdayIndex: 5, enabled: true, start: "09:00", end: "18:00" },
    { day: "Domenica", weekdayIndex: 6, enabled: false, start: "", end: "" },
  ];

  const weeklyHours =
    data.weeklyHours && Array.isArray(data.weeklyHours) && data.weeklyHours.length > 0
      ? data.weeklyHours
      : defaultHours;

  if (variant === "compact") {
    return (
      <section
        data-section="hours"
        data-variant="compact"
        className="w-full py-12 md:py-16 px-6 bg-muted/30"
      >
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--p)] mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              className="text-2xl md:text-4xl text-foreground tracking-tight"
              style={{ fontWeight: "var(--theme-font-weight-heading)" }}
            >
              {headline}
            </h2>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-card p-6 md:p-8 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 md:gap-y-5">
              {weeklyHours.map((h: WeeklyHourRow, idx: number) => {
                const closed = !h.enabled;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-4 pb-3 border-b border-border/60 last:border-b-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-b-0"
                  >
                    <span className="text-sm md:text-base font-medium text-foreground">
                      {h.day}
                    </span>
                    {closed ? (
                      <span className="text-xs md:text-sm font-semibold uppercase tracking-wider text-destructive">
                        Chiuso
                      </span>
                    ) : (
                      <span className="text-sm md:text-base text-muted-foreground font-mono tabular-nums">
                        {h.start} – {h.end}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="hours"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-background"
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10 md:mb-12">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--p)]/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            className="text-3xl md:text-5xl text-foreground tracking-tight"
            style={{ fontWeight: "var(--theme-font-weight-heading)" }}
          >
            {headline}
          </h2>
        </div>

        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-sm">
          <table className="w-full">
            <tbody className="divide-y divide-border">
              {weeklyHours.map((h: WeeklyHourRow, idx: number) => {
                const closed = !h.enabled;
                return (
                  <tr
                    key={idx}
                    className="transition duration-[var(--theme-motion-duration)] hover:bg-muted/40"
                  >
                    <td className="px-5 md:px-7 py-4 md:py-5 text-sm md:text-base font-medium text-foreground w-1/2">
                      {h.day}
                    </td>
                    <td className="px-5 md:px-7 py-4 md:py-5 text-right text-sm md:text-base font-mono tabular-nums">
                      {closed ? (
                        <span className="text-xs md:text-sm font-semibold uppercase tracking-wider text-destructive">
                          Chiuso
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {h.start} <span className="mx-2">–</span> {h.end}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
