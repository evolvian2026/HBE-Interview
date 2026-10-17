/** Brand colour helpers (pure): validation against WCAG contrast and the shades used by the UI. */

export const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix towards white (t>0) or black (t<0). */
export function shade(hex: string, t: number): string {
  const c = rgb(hex);
  return toHex(c.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));
}

/**
 * Why a colour can't be the brand colour, or null. Buttons put white text on it and links use it on white, so it
 * needs ≥ 4.5:1 against white (WCAG AA for normal text).
 */
export function brandColorProblem(hex: string): string | null {
  if (!HEX.test(hex)) return "Use a hex colour like #1d4ed8";
  const c = contrast(hex, "#ffffff");
  if (c < 4.5) return `This colour is too light for white text (contrast ${c.toFixed(1)}:1, needs 4.5:1). Try a darker shade such as ${darkEnough(hex)}.`;
  return null;
}

/** The lightest shade of `hex` that meets 4.5:1 against white. */
export function darkEnough(hex: string): string {
  for (let t = 0; t >= -0.9; t -= 0.05) {
    const s = shade(hex, t);
    if (contrast(s, "#ffffff") >= 4.5) return s;
  }
  return "#000000";
}

/** CSS custom properties that re-theme Tailwind's brand-* utilities. */
export function brandVars(hex: string): Record<string, string> {
  return {
    "--color-brand-50": shade(hex, 0.92),
    "--color-brand-100": shade(hex, 0.84),
    "--color-brand-200": shade(hex, 0.7),
    "--color-brand-500": shade(hex, 0.15),
    "--color-brand-600": hex,
    "--color-brand-700": shade(hex, -0.18),
  };
}
