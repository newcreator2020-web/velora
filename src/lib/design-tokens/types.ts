export type DesignTokenFontStyle = "sans" | "serif" | "display" | "mono";

export type DesignTokenRadius = "none" | "sm" | "md" | "lg" | "xl" | "full";

export type DesignTokenShadowStyle = "flat" | "soft" | "medium" | "sharp";

export type DesignTokenDensity = "compact" | "default" | "comfortable";

export type DesignTokenMotion = "none" | "subtle" | "default" | "playful";

export type DesignTokenSectionStyle = "card" | "minimal" | "striped" | "raised";

export type DesignTokenButtonStyle = "solid" | "outline" | "soft" | "glass" | "shadow";

export type DesignTokenPhotographyStyle = "warm" | "cool" | "mono" | "vivid" | "natural";

export type DesignTokensPalette = {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  accent: string;
  accentForeground: string;
  card: string;
  cardForeground: string;
};

export type DesignTokensTypography = {
  headingFont: DesignTokenFontStyle;
  bodyFont: DesignTokenFontStyle;
  headingScale: 1 | 1.1 | 1.2 | 1.3 | 1.4;
  bodyLineHeight: 1.5 | 1.6 | 1.7 | 1.8;
  fontWeightHeading: 400 | 500 | 600 | 700 | 800 | 900;
  fontWeightBody: 300 | 400 | 500 | 600 | 700;
};

export type DesignTokensLayout = {
  radius: DesignTokenRadius;
  shadow: DesignTokenShadowStyle;
  spacing: DesignTokenDensity;
  containerMaxWidth: "max-w-3xl" | "max-w-4xl" | "max-w-5xl" | "max-w-6xl" | "max-w-7xl";
  density: DesignTokenDensity;
  motion: DesignTokenMotion;
  sectionStyle: DesignTokenSectionStyle;
  buttonStyle: DesignTokenButtonStyle;
  photographyStyle: DesignTokenPhotographyStyle;
  bodyMaxWidth: 1024 | 1140 | 1200 | 1280 | 1440;
};

export type DesignPresetId =
  "elegant" | "soft_beauty" | "barber_strong" | "minimal" | "editorial" | "warm_natural" | "luxury";

export type DesignPreset = {
  id: DesignPresetId;
  name: string;
  description: string;
  palette: DesignTokensPalette;
  typography: DesignTokensTypography;
  layout: DesignTokensLayout;
};

export type AppliedThemeResult = {
  cssVars: Record<string, string>;
  bodyFontClass: string;
  headingFontClass: string;
  bodyFontVariable: string;
  headingFontVariable: string;
  bodyFontFamily: string;
  headingFontFamily: string;
  radiusClass: string;
};
