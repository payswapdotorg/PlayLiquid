/**
 * SPARK VIEWPORT PROJECTION (R6, lock rule 16).
 *
 * Spark is `9:16`, `portrait`, `mobile-first`. This module projects THAT
 * profile shape into typed viewport data and provides the pure projection
 * of an arbitrary screen rectangle onto the largest centered 9:16 frame.
 * It is presentation-FREE by design: PL-033's game-ui owns rendering; the
 * runtime only needs the typed geometry (R6 demonstrated, no UI built).
 *
 * Pure module: no IO, no clocks, no globals.
 */

import type { SparkTargetProfile } from "@playliquid/runtime-contracts";

/** The canonical Spark aspect ratio (R6). */
export const SPARK_ASPECT_RATIO = "9:16" as const;

/** The Spark form factor / orientation pair (R6). */
export const SPARK_ORIENTATION = "portrait" as const;
export const SPARK_FORM_FACTOR = "mobile-first" as const;

/** The typed 9:16 portrait projection of a Spark target profile. */
export interface SparkViewportProjection {
  /** Discriminator: a projection (never a refusal). */
  readonly ok: true;
  readonly kind: "spark-viewport-projection";
  readonly formFactor: "mobile-first";
  readonly orientation: "portrait";
  readonly aspectRatio: "9:16";
  /** Parsed aspect numerator (always 9 for a valid Spark profile). */
  readonly aspectWidth: number;
  /** Parsed aspect denominator (always 16 for a valid Spark profile). */
  readonly aspectHeight: number;
}

/** Typed viewport refusal codes (kebab-case, E8 discipline). */
export type SparkViewportRefusalCode = "viewport/not-spark-shape" | "viewport/invalid-screen";

/** A typed viewport refusal. */
export interface SparkViewportRefusal {
  readonly ok: false;
  readonly code: SparkViewportRefusalCode;
  readonly message: string;
}

function parseAspect(aspectRatio: string): { w: number; h: number } | null {
  const match = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(aspectRatio);
  if (match === null) return null;
  return { w: Number(match[1]), h: Number(match[2]) };
}

/**
 * Projects the Spark target profile into the typed 9:16 portrait viewport
 * (R6). Total over untrusted input: a profile that is not 9:16 portrait
 * mobile-first is a typed refusal, never a coerced shape.
 */
export function projectSparkViewport(profile: SparkTargetProfile): SparkViewportProjection | SparkViewportRefusal {
  if (
    profile?.formFactor !== SPARK_FORM_FACTOR ||
    profile?.orientation !== SPARK_ORIENTATION ||
    profile?.aspectRatio !== SPARK_ASPECT_RATIO
  ) {
    return {
      ok: false,
      code: "viewport/not-spark-shape",
      message: `spark viewport requires 9:16 portrait mobile-first, got ${String(profile?.aspectRatio)}/${String(profile?.orientation)}/${String(profile?.formFactor)}`,
    };
  }
  const aspect = parseAspect(profile.aspectRatio);
  if (aspect === null || aspect.w >= aspect.h) {
    return {
      ok: false,
      code: "viewport/not-spark-shape",
      message: `spark viewport requires a portrait aspect (width < height), got ${profile.aspectRatio}`,
    };
  }
  return {
    ok: true,
    kind: "spark-viewport-projection",
    formFactor: SPARK_FORM_FACTOR,
    orientation: SPARK_ORIENTATION,
    aspectRatio: SPARK_ASPECT_RATIO,
    aspectWidth: aspect.w,
    aspectHeight: aspect.h,
  };
}

/** A host screen rectangle in device pixels (caller data). */
export interface ScreenRectangle {
  readonly width: number;
  readonly height: number;
}

/** A projected 9:16 frame inside a screen (x/y offset from top-left). */
export interface ProjectedSparkFrame {
  /** Discriminator: a projection (never a refusal). */
  readonly ok: true;
  readonly kind: "projected-spark-frame";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly orientation: "portrait";
}

/**
 * Projects a screen rectangle onto the largest centered 9:16 frame (R6).
 * Pure math over caller-supplied screen data; deterministic everywhere.
 * Non-positive or non-finite screen dimensions are typed refusals.
 */
export function projectScreenToSparkFrame(
  projection: SparkViewportProjection,
  screen: ScreenRectangle,
): ProjectedSparkFrame | SparkViewportRefusal {
  if (
    typeof screen?.width !== "number" ||
    typeof screen?.height !== "number" ||
    !Number.isFinite(screen.width) ||
    !Number.isFinite(screen.height) ||
    screen.width <= 0 ||
    screen.height <= 0
  ) {
    return {
      ok: false,
      code: "viewport/invalid-screen",
      message: "screen dimensions must be finite positive numbers",
    };
  }
  const scale = Math.min(screen.width / projection.aspectWidth, screen.height / projection.aspectHeight);
  const width = projection.aspectWidth * scale;
  const height = projection.aspectHeight * scale;
  return {
    ok: true,
    kind: "projected-spark-frame",
    x: (screen.width - width) / 2,
    y: (screen.height - height) / 2,
    width,
    height,
    orientation: "portrait",
  };
}
