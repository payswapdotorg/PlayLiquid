/**
 * FIRST-RUN EMPTY SURFACE (presentational, UX-002 frozen contract): the one
 * container every no-data Lab surface renders — it explains what the Lab
 * surface does, and offers the REAL next-step control
 * (`data-testid="gameos-empty-next-step"`) that performs a supported
 * operation through the module's existing typed port/store actions (one
 * request-search intent through the command port, or one authoritative
 * read-model pull through the data port).
 *
 * Presentational component: copy comes from `view/onboarding.ts` (the ONE
 * copy owner) and the action flows out through the optional `onNextStep`
 * callback. No dead controls: when no real operation is wired, no button
 * renders — the honest prose stays. No fabricated success, ever (E11).
 */

import type { ReactNode } from "react";
import type { EmptySurfaceCopy } from "../view/onboarding.ts";
import { STYLE } from "./tokens.ts";

export interface EmptySurfaceProps {
  /** The surface's copy (title, explanation, next-step label, guidance). */
  readonly copy: EmptySurfaceCopy;
  /**
   * The REAL next-step operation (a typed intent dispatch or the store's
   * `refresh()`). Optional only for hosts that wire no control; when
   * absent, no button renders and the honest prose explains why.
   */
  readonly onNextStep?: () => void;
}

/** The first-run empty-state container (frozen testids, real next step). */
export function EmptySurface({ copy, onNextStep }: EmptySurfaceProps): ReactNode {
  return (
    <div data-testid="gameos-empty-state" role="status" style={STYLE.emptySurface}>
      <p style={STYLE.emptyTitle}>{copy.title}</p>
      <p style={STYLE.emptyExplanation}>{copy.explanation}</p>
      {onNextStep === undefined ? null : (
        <button type="button" data-testid="gameos-empty-next-step" onClick={onNextStep} style={STYLE.emptyStepButton}>
          {copy.nextStepLabel}
        </button>
      )}
      {copy.guidance.map((line) => (
        <p key={line} style={STYLE.emptyGuidance}>
          {line}
        </p>
      ))}
    </div>
  );
}
