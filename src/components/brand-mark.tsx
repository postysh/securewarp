// Single source of truth for the current brand-mark variant. To try a
// different candidate across every surface, change `CURRENT` to "A",
// "M", "V", or "W". Files live under /public/logos/ without spaces
// so the static path resolves cleanly in every browser.
type LogoVariant = "A" | "M" | "V" | "W";
const CURRENT: LogoVariant = "W";

const SRC: Record<LogoVariant, string> = {
  A: "/logos/mark-a.svg",
  M: "/logos/mark-m.svg",
  V: "/logos/mark-v.svg",
  W: "/logos/mark-w.svg",
};

interface BrandMarkProps {
  size?: number;
  className?: string;
  // "brand"  — render the SVG as-is (brand coral).
  // "mono"   — render the glyph silhouette painted with `currentColor`,
  //            so the caller's CSS `color` drives the visible fill.
  //            Use this anywhere the mark sits on a theme-aware
  //            background (e.g. the auth screen's left panel, which
  //            flips black→white between light and dark).
  tone?: "brand" | "mono";
}

export function BrandMark({ size = 22, className, tone = "brand" }: BrandMarkProps) {
  // The source SVGs export a 375×375 viewBox with the glyph filling
  // only the centre ~60%. Cropping that optical padding with negative
  // margin lets every callsite pick a size without worrying about the
  // whitespace baked into the file.
  const trim = -Math.round(size * 0.2);
  const trimRight = -Math.round(size * 0.32);
  const src = SRC[CURRENT];

  if (tone === "mono") {
    // CSS mask draws the SVG's alpha channel and fills it with whatever
    // `currentColor` resolves to on the ancestor — which is how every
    // theme-adaptive colour token (text-inverse, text-primary, etc.)
    // stays correct across light + dark without a second SVG export.
    return (
      <span
        aria-label="SecureWarp"
        role="img"
        className={className}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          marginTop: trim,
          marginBottom: trim,
          marginLeft: trim,
          marginRight: trimRight,
          backgroundColor: "currentColor",
          WebkitMaskImage: `url(${src})`,
          maskImage: `url(${src})`,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="SecureWarp"
      width={size}
      height={size}
      className={className}
      style={{
        display: "block",
        marginTop: trim,
        marginBottom: trim,
        marginLeft: trim,
        marginRight: trimRight,
      }}
    />
  );
}
