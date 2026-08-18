import type { PublicTheme } from "@/lib/server/content-engine";
import {
  validateHexColor,
  validateFontPreset,
  validateRadiusPreset,
} from "@/lib/server/content-engine";

const FONT_PRESET_CLASS: Record<string, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
  display: "font-sans",
};

const RADIUS_PRESET_CLASS: Record<string, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function SiteShell(props: { theme: PublicTheme; children: React.ReactNode }) {
  const t = props.theme;
  const styleVars: Record<string, string> = {};
  if (validateHexColor(t.primary)) styleVars["--site-primary"] = t.primary;
  if (validateHexColor(t.background)) styleVars["--site-bg"] = t.background;
  if (validateHexColor(t.foreground)) styleVars["--site-fg"] = t.foreground;
  if (validateHexColor(t.muted)) styleVars["--site-muted"] = t.muted;

  const headingFontClass = validateFontPreset(t.headingFont, true)
    ? FONT_PRESET_CLASS[t.headingFont as string]
    : "font-sans";
  const bodyFontClass = validateFontPreset(t.bodyFont, false)
    ? FONT_PRESET_CLASS[t.bodyFont as string]
    : "font-sans";
  const radiusClass = validateRadiusPreset(t.radius)
    ? RADIUS_PRESET_CLASS[t.radius as string]
    : "rounded-md";

  return (
    <div
      className={`min-h-screen w-full ${bodyFontClass} bg-background text-foreground ${radiusClass}`}
      style={styleVars}
    >
      <div className={`${headingFontClass}`} data-site-heading-font>
        {props.children}
      </div>
      <footer className="w-full py-10 px-6 border-t border-border text-sm text-muted-foreground">
        <div className="max-w-5xl mx-auto text-center">
          <p>Sito realizzato con Velora</p>
        </div>
      </footer>
    </div>
  );
}
