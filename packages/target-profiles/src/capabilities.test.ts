/**
 * Capability descriptors: frozen vocabularies and structural guards.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_MODALITIES,
  RENDER_API_CLASSES,
  VRAM_CLASSES,
  isInputModality,
  isRenderApiClass,
  isTargetCapabilities,
  isVramClass,
} from "./capabilities.ts";
import type { TargetCapabilities } from "./capabilities.ts";

const VALID: TargetCapabilities = {
  render: "webgpu",
  vramClass: "medium",
  inputModalities: ["keyboard", "mouse"],
  screen: { touch: false, refreshHz: 60 },
};

test("render/API classes include the web/desktop/console buckets and none", () => {
  assert.deepEqual([...RENDER_API_CLASSES], ["none", "webgl2", "webgpu", "vulkan", "metal", "d3d12", "vendor"]);
  assert.equal(isRenderApiClass("webgpu"), true);
  assert.equal(isRenderApiClass("directx"), false);
  assert.equal(isRenderApiClass(""), false);
});

test("VRAM classes are the four conservative buckets", () => {
  assert.deepEqual([...VRAM_CLASSES], ["none", "low", "medium", "high"]);
  assert.equal(isVramClass("low"), true);
  assert.equal(isVramClass("unbounded"), false);
});

test("input modalities cover touch/keyboard/mouse/gamepad/motion/hand-tracking/voice/none", () => {
  assert.deepEqual([...INPUT_MODALITIES], [
    "touch",
    "keyboard",
    "mouse",
    "gamepad",
    "motion",
    "hand-tracking",
    "voice",
    "none",
  ]);
  assert.equal(isInputModality("touch"), true);
  assert.equal(isInputModality("haptics"), false);
});

test("the capability guard accepts a well-formed descriptor", () => {
  assert.equal(isTargetCapabilities(VALID), true);
});

test("the capability guard refuses malformed descriptors (fail closed)", () => {
  assert.equal(isTargetCapabilities({ ...VALID, render: "raytracing" }), false);
  assert.equal(isTargetCapabilities({ ...VALID, vramClass: "ultra" }), false);
  assert.equal(isTargetCapabilities({ ...VALID, inputModalities: ["mind-control"] }), false);
  assert.equal(isTargetCapabilities({ ...VALID, inputModalities: "touch" }), false);
  assert.equal(isTargetCapabilities({ ...VALID, screen: { touch: "yes" } }), false);
  assert.equal(isTargetCapabilities({ ...VALID, screen: { touch: false, refreshHz: 0 } }), false);
  assert.equal(isTargetCapabilities({ ...VALID, screen: { touch: false, refreshHz: 59.5 } }), false);
  assert.equal(isTargetCapabilities(null), false);
  assert.equal(isTargetCapabilities(undefined), false);
});

test("a descriptor with no explicit refresh rate is still valid (optional field)", () => {
  assert.equal(isTargetCapabilities({ ...VALID, screen: { touch: true } }), true);
});
