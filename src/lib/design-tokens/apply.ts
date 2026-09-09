import "server-only";
import { loadTenantFonts } from "@/lib/server/theme-fonts";
import type {
  DesignPreset,
  DesignTokensPalette,
  DesignTokensLayout,
  AppliedThemeResult,
} from "./types";
import { getDesignPreset } from "./presets";
import type { PublicTheme } from "@/lib/server/content-engine";
import { validateHexColor, validateRadiusPreset } from "@/lib/server/content-engine";

const RADIUS_PRESET_CLASS: Record<string, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex);
  if (!m) return null;
  const v = String(m[1] ?? "");
  if (v.length === 3) {
    const c0 = v.charAt(0) || "0";
    const c1 = v.charAt(1) || "0";
    const c2 = v.charAt(2) || "0";
    return {
      r: parseInt(c0 + c0, 16),
      g: parseInt(c1 + c1, 16),
      b: parseInt(c2 + c2, 16),
    };
  }
  return {
    r: parseInt(v.slice(0, 2) || "00", 16),
    g: parseInt(v.slice(2, 4) || "00", 16),
    b: parseInt(v.slice(4, 6) || "00", 16),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function resolveMergedPalette(
  preset: DesignPreset,
  theme: PublicTheme | null | undefined,
): DesignTokensPalette {
  const p = { ...preset.palette };
  if (!theme) return p;
  if (validateHexColor(theme.primary)) p.primary = theme.primary;
  if (validateHexColor(theme.background)) p.background = theme.background;
  if (validateHexColor(theme.foreground)) p.foreground = theme.foreground;
  if (validateHexColor(theme.muted)) p.muted = theme.muted;
  return p;
}

function resolveMergedLayout(
  preset: DesignPreset,
  theme: PublicTheme | null | undefined,
): DesignTokensLayout {
  const l = { ...preset.layout };
  if (theme && validateRadiusPreset(theme.radius)) {
    l.radius = theme.radius as DesignTokensLayout["radius"];
  }
  return l;
}

function resolveFonts(
  preset: DesignPreset,
  theme: PublicTheme | null | undefined,
): ReturnType<typeof loadTenantFonts> {
  let body = preset.typography.bodyFont;
  let heading = preset.typography.headingFont;
  if (theme) {
    if (typeof theme.bodyFont === "string" && theme.bodyFont.length > 0) {
      body = theme.bodyFont as typeof preset.typography.bodyFont;
    }
    if (typeof theme.headingFont === "string" && theme.headingFont.length > 0) {
      heading = theme.headingFont as typeof preset.typography.headingFont;
    }
  }
  return loadTenantFonts(body, heading);
}

export function applyTheme(
  theme: PublicTheme | null | undefined,
  presetId?: string | null,
): AppliedThemeResult {
  const preset = getDesignPreset(presetId);
  const palette = resolveMergedPalette(preset, theme);
  const layout = resolveMergedLayout(preset, theme);
  const fonts = resolveFonts(preset, theme);

  const shadowMap: Record<string, string> = {
    flat: "0 0 #0000,0 0 #0000",
    soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
    medium: "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
    sharp: "2px 2px 0 0 rgb(0 0 0 / 0.15), 0 0 0 1px rgb(0 0 0 / 0.1)",
  };

  const spacingMap: Record<string, number> = {
    tight: 0.85,
    normal: 1,
    loose: 1.15,
  };

  const radiusPx: Record<string, string> = {
    none: "0px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "20px",
    full: "9999px",
  };

  const cssVars: Record<string, string> = {};

  cssVars["--p"] = palette.primary;
  cssVars["--p-foreground"] = palette.primaryForeground;
  cssVars["--s"] = palette.secondary;
  cssVars["--s-foreground"] = palette.secondaryForeground;
  cssVars["--background"] = palette.background;
  cssVars["--foreground"] = palette.foreground;
  cssVars["--muted"] = palette.muted;
  cssVars["--muted-foreground"] = palette.mutedForeground;
  cssVars["--border"] = palette.border;
  cssVars["--accent"] = palette.accent;
  cssVars["--accent-foreground"] = palette.accentForeground;
  cssVars["--card"] = palette.card;
  cssVars["--card-foreground"] = palette.cardForeground;

  cssVars["--primary"] = palette.primary;
  cssVars["--primary-foreground"] = palette.primaryForeground;
  cssVars["--secondary"] = palette.secondary;
  cssVars["--secondary-foreground"] = palette.secondaryForeground;
  cssVars["--site-primary"] = palette.primary;
  cssVars["--site-bg"] = palette.background;
  cssVars["--site-fg"] = palette.foreground;
  cssVars["--site-muted"] = palette.muted;

  cssVars["--p-rgb"] = (() => {
    const rgb = hexToRgb(palette.primary);
    return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : "0,0,0";
  })();

  const radiusPxAny = radiusPx as Record<string, string>;
  const shadowMapAny = shadowMap as Record<string, string>;
  const spacingMapAny = spacingMap as Record<string, number>;
  const radiusClassAny = RADIUS_PRESET_CLASS as Record<string, string>;

  const radiusStr = radiusPxAny[layout.radius] ?? (radiusPxAny["md"] || "8px");
  const shadowSoft =
    shadowMapAny["soft"] || "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)";
  const shadowFlat = shadowMapAny["flat"] || "0 0 #0000,0 0 #0000";

  cssVars["--radius"] = radiusStr;
  cssVars["--theme-font-family-body"] = fonts.bodyFontFamily;
  cssVars["--theme-font-family-heading"] = fonts.headingFontFamily;
  cssVars["--shadow"] = shadowMapAny[layout.shadow] ?? shadowSoft;
  cssVars["--shadow-sm"] = shadowFlat;
  cssVars["--shadow-lg"] =
    layout.shadow === "flat"
      ? shadowFlat
      : "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.08)";

  const spacingMult = spacingMapAny[layout.spacing] ?? 1;
  cssVars["--theme-spacing-multiplier"] = String(spacingMult);
  cssVars["--theme-shadow-multiplier"] =
    layout.shadow === "flat" ? "0" : layout.shadow === "sharp" ? "1.3" : "1";
  cssVars["--theme-radius-multiplier"] =
    layout.radius === "none"
      ? "0"
      : layout.radius === "xl" || layout.radius === "full"
        ? "1.4"
        : "1";

  cssVars["--ring"] = withAlpha(palette.primary, 0.45);
  cssVars["--input"] = palette.border;
  cssVars["--destructive"] = "#EF4444";
  cssVars["--destructive-foreground"] = "#FFFFFF";
  cssVars["--popover"] = palette.card;
  cssVars["--popover-foreground"] = palette.cardForeground;

  return {
    cssVars,
    bodyFontClass: fonts.bodyClass,
    headingFontClass: fonts.headingClass,
    bodyFontVariable: fonts.bodyVariable,
    headingFontVariable: fonts.headingVariable,
    bodyFontFamily: fonts.bodyFontFamily,
    headingFontFamily: fonts.headingFontFamily,
    radiusClass: radiusClassAny[layout.radius] ?? (radiusClassAny["md"] || "rounded-md"),
  };
}

export { DESIGN_PRESETS, DESIGN_PRESET_LIST } from "./presets";
export type {
  DesignPreset,
  DesignPresetId,
  DesignTokensPalette,
  DesignTokensTypography,
  DesignTokensLayout,
  AppliedThemeResult,
} from "./types";
