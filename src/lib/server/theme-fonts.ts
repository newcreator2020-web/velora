import "server-only";
import {
  Inter,
  Roboto,
  Nunito,
  Poppins,
  DM_Sans,
  Manrope,
  Playfair_Display,
  Cormorant_Garamond,
  Lora,
  Merriweather,
  Fraunces,
  Libre_Baskerville,
} from "next/font/google";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});
const roboto = Roboto({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-roboto",
});
const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-nunito",
});
const poppins = Poppins({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});
const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-playfair-display",
});
const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-cormorant-garamond",
});
const lora = Lora({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-lora",
});
const merriweather = Merriweather({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-merriweather",
});
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-fraunces",
});
const libreBaskerville = Libre_Baskerville({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-libre-baskerville",
});

type NextFontResult = {
  variable: string;
  className: string;
  style: { fontFamily: string };
};

const BODY_FONT_MAP: Record<string, NextFontResult> = {
  Inter: inter,
  Roboto: roboto,
  Nunito: nunito,
  Poppins: poppins,
  "DM Sans": dmSans,
  Manrope: manrope,
  "Plus Jakarta Sans": dmSans,
  "Space Grotesk": manrope,
  Outfit: manrope,
  Raleway: poppins,
  Montserrat: poppins,
  "Open Sans": roboto,
  Lato: roboto,
  sans: inter,
  serif: lora,
  mono: roboto,
  display: inter,
};

const HEADING_FONT_MAP: Record<string, NextFontResult> = {
  "Playfair Display": playfairDisplay,
  "Cormorant Garamond": cormorantGaramond,
  Lora: lora,
  Merriweather: merriweather,
  Fraunces: fraunces,
  "Libre Baskerville": libreBaskerville,
  "Source Serif Pro": merriweather,
  Inter: inter,
  Roboto: roboto,
  Nunito: nunito,
  Poppins: poppins,
  "DM Sans": dmSans,
  Manrope: manrope,
  "Plus Jakarta Sans": dmSans,
  "Space Grotesk": manrope,
  Outfit: manrope,
  Raleway: poppins,
  Montserrat: poppins,
  "Open Sans": roboto,
  Lato: roboto,
  sans: inter,
  serif: lora,
  mono: roboto,
  display: playfairDisplay,
};

export type LoadedTenantFonts = {
  bodyVariable: string;
  headingVariable: string;
  bodyClass: string;
  headingClass: string;
  bodyFontFamily: string;
  headingFontFamily: string;
};

const BODY_KEYS = [
  "Inter",
  "Roboto",
  "Nunito",
  "Poppins",
  "DM Sans",
  "Plus Jakarta Sans",
  "Manrope",
  "Space Grotesk",
  "Outfit",
  "Raleway",
  "Montserrat",
  "Open Sans",
  "Lato",
] as const;

const HEADING_KEYS = [
  "Playfair Display",
  "Cormorant Garamond",
  "Lora",
  "Merriweather",
  "Fraunces",
  "Libre Baskerville",
  "Source Serif Pro",
] as const;

export const SUPPORTED_BODY_FONTS: readonly string[] = BODY_KEYS;
export const SUPPORTED_HEADING_FONTS: readonly string[] = HEADING_KEYS;
export const SUPPORTED_ALL_FONTS: readonly string[] = [...BODY_KEYS, ...HEADING_KEYS];

export function loadTenantFonts(
  bodyFamily: string | null,
  headingFamily: string | null,
): LoadedTenantFonts {
  const bodyMatch =
    typeof bodyFamily === "string" && bodyFamily.length > 0
      ? (BODY_FONT_MAP[bodyFamily] ?? null)
      : null;
  const headingMatch =
    typeof headingFamily === "string" && headingFamily.length > 0
      ? (HEADING_FONT_MAP[headingFamily] ?? null)
      : null;

  const body = bodyMatch ?? inter;
  const heading = headingMatch ?? inter;

  return {
    bodyVariable: body.variable,
    headingVariable: heading.variable,
    bodyClass: body.className,
    headingClass: heading.className,
    bodyFontFamily: body.style.fontFamily,
    headingFontFamily: heading.style.fontFamily,
  };
}

export const GLOBAL_FONT_CLASSES = [
  inter.variable,
  roboto.variable,
  nunito.variable,
  poppins.variable,
  dmSans.variable,
  manrope.variable,
  playfairDisplay.variable,
  cormorantGaramond.variable,
  lora.variable,
  merriweather.variable,
  fraunces.variable,
  libreBaskerville.variable,
].join(" ");
