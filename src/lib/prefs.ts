// Text-size preference. Everything in the app is sized in rem, so scaling the
// root font-size makes the whole UI bigger proportionally without breaking the
// layout. 1 = normal; larger = bigger for easier reading.
export const FONT_SCALE_KEY = "eei_font_scale";
export const FONT_SCALES = [1, 1.15, 1.3, 1.5] as const;
export const FONT_SCALE_LABELS: Record<number, string> = {
  1: "Normal",
  1.15: "Large",
  1.3: "Larger",
  1.5: "Largest",
};

export function applyFontScale(scale: number) {
  document.documentElement.style.fontSize = `${Math.round(16 * scale)}px`;
}

export function saveFontScale(scale: number) {
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(scale));
  } catch {
    /* storage may be unavailable */
  }
  applyFontScale(scale);
}

export function currentFontScale(): number {
  try {
    return Number(localStorage.getItem(FONT_SCALE_KEY)) || 1;
  } catch {
    return 1;
  }
}
