import type { PublicSection } from "@/lib/server/content-engine";
import { HeroSectionComponent } from "@/components/site/sections/Hero";
import { AboutSectionComponent } from "@/components/site/sections/About";
import { ServicesSectionComponent } from "@/components/site/sections/Services";
import { GallerySectionComponent } from "@/components/site/sections/Gallery";
import { StaffSectionComponent } from "@/components/site/sections/Staff";
import { ReviewsSectionComponent } from "@/components/site/sections/Reviews";
import { ContactSectionComponent } from "@/components/site/sections/Contact";

type RenderFn = (section: PublicSection) => React.ReactNode | null;

const HERO: RenderFn = (s) => (s.type === "hero" ? <HeroSectionComponent {...s} /> : null);
const ABOUT: RenderFn = (s) => (s.type === "about" ? <AboutSectionComponent {...s} /> : null);
const SERVICES: RenderFn = (s) =>
  s.type === "services" ? <ServicesSectionComponent {...s} /> : null;
const GALLERY: RenderFn = (s) => (s.type === "gallery" ? <GallerySectionComponent {...s} /> : null);
const STAFF: RenderFn = (s) => (s.type === "staff" ? <StaffSectionComponent {...s} /> : null);
const REVIEWS: RenderFn = (s) => (s.type === "reviews" ? <ReviewsSectionComponent {...s} /> : null);
const CONTACT: RenderFn = (s) => (s.type === "contact" ? <ContactSectionComponent {...s} /> : null);

export const SECTION_RENDERERS: Record<PublicSection["type"], RenderFn> = {
  hero: HERO,
  about: ABOUT,
  services: SERVICES,
  gallery: GALLERY,
  staff: STAFF,
  reviews: REVIEWS,
  contact: CONTACT,
};

export function SiteRenderer({ sections }: { sections: PublicSection[] }) {
  const parts: React.ReactNode[] = sections.map((s, i) => {
    const r = SECTION_RENDERERS[s.type];
    if (!r) return null;
    const node = r(s);
    if (node == null) return null;
    return (
      <li key={`sec-${i}-${s.type}`} className="w-full list-none">
        {node}
      </li>
    );
  });
  const filtered = parts.filter((n): n is React.ReactNode => n != null);
  return <ol className="flex flex-col w-full list-none p-0 m-0">{filtered}</ol>;
}
