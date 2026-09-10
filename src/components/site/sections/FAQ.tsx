"use client";

import { useState } from "react";
import type { PublicSection, FAQSection, FAQItem } from "@/lib/server/content-engine";

export function FAQSectionComponent(s: PublicSection) {
  const sec = s as FAQSection;
  const variant = sec.variant === "compact" ? "compact" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Domande Frequenti";

  const items = data.items && Array.isArray(data.items) && data.items.length > 0 ? data.items : [];

  if (items.length === 0) return null;

  if (variant === "compact") {
    return (
      <section
        data-section="faq"
        data-variant="compact"
        className="w-full py-14 md:py-20 px-6 bg-muted/30"
      >
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
            {items.map((item: FAQItem, idx: number) => (
              <div
                key={idx}
                className="rounded-[var(--radius)] border border-border bg-card p-6 md:p-7 shadow-sm"
              >
                <h3
                  className="text-base md:text-lg text-foreground mb-3 leading-snug"
                  style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                >
                  {item.question}
                </h3>
                <p className="text-sm md:text-[15px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="faq"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-background"
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10 md:mb-14">
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

        <div className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border bg-card shadow-sm overflow-hidden">
          {items.map((item: FAQItem, idx: number) => (
            <FAQAccordionItem key={idx} index={idx} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQAccordionItem({ index, item }: { index: number; item: FAQItem }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <div className="transition duration-[var(--theme-motion-duration)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-6 px-5 md:px-7 py-5 md:py-6 text-left hover:bg-muted/30 transition duration-[var(--theme-motion-duration)]"
        aria-expanded={open}
      >
        <h3
          className="text-sm md:text-base text-foreground flex-1 pr-4"
          style={{ fontWeight: "var(--theme-font-weight-heading)" }}
        >
          {item.question}
        </h3>
        <span
          className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full border border-border transition-transform duration-[var(--theme-motion-duration)] ${open ? "rotate-45 bg-[var(--p)] border-[var(--p)] text-[var(--p-foreground)]" : "text-muted-foreground"}`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
      </button>
      <div
        className={`grid transition-all duration-[var(--theme-motion-duration)] ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="px-5 md:px-7 pb-6 md:pb-7 pt-0 text-sm md:text-[15px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {item.answer}
          </p>
        </div>
      </div>
    </div>
  );
}
