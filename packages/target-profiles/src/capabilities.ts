/**
 * Typed per-target capability descriptors: render/API class, VRAM class,
 * input modalities and screen shape.
 *
 * A capability descriptor is the game's DECLARED requirement set for a
 * target — not hardware truth. Hardware truth for console-class targets
 * is vendor-SDK territory (opaque, carried by the console record's
 * vendor data); for everything else the classes are conservative,
 * engine-independent buckets (E3/E4: no provider SDK types in contracts).
 */

/** Frozen render/API classes. `vendor` is the opaque console-class entry. */
export const RENDER_API_CLASSES = Object.freeze([
  "none",
  "webgl2",
  "webgpu",
  "vulkan",
  "metal",
  "d3d12",
  "vendor",
] as const);

/** A render/API class. */
export type RenderApiClass = (typeof RENDER_API_CLASSES)[number];

/** Type guard: a known render/API class. */
export function isRenderApiClass(value: unknown): value is RenderApiClass {
  return typeof value === "string" && (RENDER_API_CLASSES as readonly string[]).includes(value);
}

/** Frozen VRAM classes (declared minimum the game requires). */
export const VRAM_CLASSES = Object.freeze(["none", "low", "medium", "high"] as const);

/** A VRAM class. */
export type VramClass = (typeof VRAM_CLASSES)[number];

/** Type guard: a known VRAM class. */
export function isVramClass(value: unknown): value is VramClass {
  return typeof value === "string" && (VRAM_CLASSES as readonly string[]).includes(value);
}

/** Frozen input modalities. */
export const INPUT_MODALITIES = Object.freeze([
  "touch",
  "keyboard",
  "mouse",
  "gamepad",
  "motion",
  "hand-tracking",
  "voice",
  "none",
] as const);

/** An input modality. */
export type InputModality = (typeof INPUT_MODALITIES)[number];

/** Type guard: a known input modality. */
export function isInputModality(value: unknown): value is InputModality {
  return typeof value === "string" && (INPUT_MODALITIES as readonly string[]).includes(value);
}

/** The screen shape a game expects on a target. */
export interface ScreenShape {
  /** Whether primary interaction is touch-based. */
  readonly touch: boolean;
  /** Minimum refresh rate the game declares (Hz), when it declares one. */
  readonly refreshHz?: number;
}

/** The typed per-target capability descriptor. */
export interface TargetCapabilities {
  readonly render: RenderApiClass;
  readonly vramClass: VramClass;
  readonly inputModalities: readonly InputModality[];
  readonly screen: ScreenShape;
}

/** Type guard: a structurally valid capability descriptor. */
export function isTargetCapabilities(value: unknown): value is TargetCapabilities {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<TargetCapabilities>;
  if (
    !isRenderApiClass(candidate.render) ||
    !isVramClass(candidate.vramClass) ||
    !Array.isArray(candidate.inputModalities) ||
    !candidate.inputModalities.every((modality) => isInputModality(modality))
  ) {
    return false;
  }
  const screen = candidate.screen as Partial<ScreenShape> | undefined;
  if (typeof screen !== "object" || screen === null || typeof screen.touch !== "boolean") {
    return false;
  }
  if (screen.refreshHz !== undefined) {
    if (typeof screen.refreshHz !== "number" || !Number.isSafeInteger(screen.refreshHz) || screen.refreshHz < 1) {
      return false;
    }
  }
  return true;
}
