import { randomUUID } from "node:crypto";
import type { PublicSection } from "@/lib/server/content-engine";
import { HeroSectionComponent } from "@/components/site/sections/Hero";
import { AboutSectionComponent } from "@/components/site/sections/About";
import { ServicesSectionComponent } from "@/components/site/sections/Services";
import { GallerySectionComponent } from "@/components/site/sections/Gallery";
import { StaffSectionComponent } from "@/components/site/sections/Staff";
import { ReviewsSectionComponent } from "@/components/site/sections/Reviews";
import { ContactSectionComponent } from "@/components/site/sections/Contact";
import { PriceListSectionComponent } from "@/components/site/sections/PriceList";
import { FeaturesCtaSectionComponent } from "@/components/site/sections/FeaturesCTA";
import { BookingWidgetSectionComponent } from "@/components/site/sections/BookingWidget";
import { NavbarSectionComponent } from "@/components/site/sections/Navbar";
import { FooterSectionComponent } from "@/components/site/sections/Footer";
import { TrustSectionComponent } from "@/components/site/sections/Trust";
import { HoursSectionComponent } from "@/components/site/sections/Hours";
import { FAQSectionComponent } from "@/components/site/sections/FAQ";
import { LocationSectionComponent } from "@/components/site/sections/Location";
import { BookingCtaSectionComponent } from "@/components/site/sections/BookingCTA";
import { WhatsappCtaSectionComponent } from "@/components/site/sections/WhatsappCTA";
import { SocialLinksSectionComponent } from "@/components/site/sections/SocialLinks";
import { LegalLinksSectionComponent } from "@/components/site/sections/LegalLinks";

type RenderFn = (section: PublicSection) => React.ReactNode | null;

const HERO: RenderFn = (s) => (s.type === "hero" ? <HeroSectionComponent {...s} /> : null);
const ABOUT: RenderFn = (s) => (s.type === "about" ? <AboutSectionComponent {...s} /> : null);
const SERVICES: RenderFn = (s) =>
  s.type === "services" ? <ServicesSectionComponent {...s} /> : null;
const GALLERY: RenderFn = (s) => (s.type === "gallery" ? <GallerySectionComponent {...s} /> : null);
const STAFF: RenderFn = (s) => (s.type === "staff" ? <StaffSectionComponent {...s} /> : null);
const REVIEWS: RenderFn = (s) => (s.type === "reviews" ? <ReviewsSectionComponent {...s} /> : null);
const CONTACT: RenderFn = (s) => (s.type === "contact" ? <ContactSectionComponent {...s} /> : null);
const PRICE_LIST: RenderFn = (s) =>
  s.type === "price_list" ? <PriceListSectionComponent {...s} /> : null;
const FEATURES_CTA: RenderFn = (s) =>
  s.type === "features_cta" ? <FeaturesCtaSectionComponent {...s} /> : null;
const BOOKING_WIDGET: RenderFn = (s) =>
  s.type === "booking_widget" ? <BookingWidgetSectionComponent {...s} /> : null;
const NAVBAR: RenderFn = (s) => (s.type === "navbar" ? <NavbarSectionComponent {...s} /> : null);
const FOOTER: RenderFn = (s) => (s.type === "footer" ? <FooterSectionComponent {...s} /> : null);
const TRUST: RenderFn = (s) => (s.type === "trust" ? <TrustSectionComponent {...s} /> : null);
const HOURS: RenderFn = (s) => (s.type === "hours" ? <HoursSectionComponent {...s} /> : null);
const FAQ: RenderFn = (s) => (s.type === "faq" ? <FAQSectionComponent {...s} /> : null);
const LOCATION: RenderFn = (s) =>
  s.type === "location" ? <LocationSectionComponent {...s} /> : null;
const BOOKING_CTA: RenderFn = (s) =>
  s.type === "booking_cta" ? <BookingCtaSectionComponent {...s} /> : null;
const WHATSAPP_CTA: RenderFn = (s) =>
  s.type === "whatsapp_cta" ? <WhatsappCtaSectionComponent {...s} /> : null;
const SOCIAL_LINKS: RenderFn = (s) =>
  s.type === "social_links" ? <SocialLinksSectionComponent {...s} /> : null;
const LEGAL_LINKS: RenderFn = (s) =>
  s.type === "legal_links" ? <LegalLinksSectionComponent {...s} /> : null;

export const SECTION_RENDERERS: Record<PublicSection["type"], RenderFn> = {
  hero: HERO,
  about: ABOUT,
  services: SERVICES,
  gallery: GALLERY,
  staff: STAFF,
  reviews: REVIEWS,
  contact: CONTACT,
  price_list: PRICE_LIST,
  features_cta: FEATURES_CTA,
  booking_widget: BOOKING_WIDGET,
  navbar: NAVBAR,
  footer: FOOTER,
  trust: TRUST,
  hours: HOURS,
  faq: FAQ,
  location: LOCATION,
  booking_cta: BOOKING_CTA,
  whatsapp_cta: WHATSAPP_CTA,
  social_links: SOCIAL_LINKS,
  legal_links: LEGAL_LINKS,
};

export function SiteRenderer({ sections }: { sections: PublicSection[] }) {
  const parts: React.ReactNode[] = sections.map((s, i) => {
    const r = SECTION_RENDERERS[s.type];
    if (!r) return null;
    const node = r(s);
    if (node == null) return null;
    const stableKey =
      ((s as unknown as Record<string, unknown>)["id"] as string | undefined) ||
      ((s as unknown as Record<string, unknown>)["_key"] as string | undefined) ||
      `sec-${i}-${String(s.type)}-${randomUUID()}`;
    return (
      <div key={stableKey} className="w-full">
        {node}
      </div>
    );
  });
  const filtered = parts.filter((n): n is React.ReactNode => n != null);
  return (
    <div data-sections className="flex flex-col w-full p-0 m-0">
      {filtered}
    </div>
  );
}
