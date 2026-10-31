"use client";

/**
 * PlayLiquid hover-to-play preview — the flagship discovery experience.
 *
 * Architecture (adapted from the proven WebFlix video-hover-preview pattern):
 * - ONE shared preview layer (rendered once at the app root) follows the
 *   currently hovered card using its actual bounding geometry.
 * - A 500ms hover dwell prevents accidental playback.
 * - Only one preview player exists at a time; showing a new card destroys
 *   the previous video first (keyed remount).
 * - The preview is a real <video> (gameplay-preview asset), muted, inline.
 * - Controls: mute toggle + scrubbable progress timeline (pointer-events on
 *   controls only; the rest of the layer passes clicks through to the card).
 * - Leaving the card stops playback and releases the video source.
 * - Moving between card and controls does NOT close the preview.
 * - Touch devices and prefers-reduced-motion never autoplay a preview.
 * - Failed playback falls back HONESTLY: the static thumbnail shows through
 *   plus a "Preview unavailable" pill. No fake slideshow, ever.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

const DWELL_MS = 500;

export interface PreviewMedia {
  previewUrl: string;
  thumbnailUrl: string;
  title: string;
}

interface PreviewState {
  media: PreviewMedia | null;
  rect: DOMRect | null;
  cardEl: HTMLElement | null;
}

let state: PreviewState = { media: null, rect: null, cardEl: null };
const listeners = new Set<() => void>();

function setState(next: PreviewState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const SERVER_SNAPSHOT: PreviewState = { media: null, rect: null, cardEl: null };

function usePreviewStore() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_SNAPSHOT,
  );
}

function deviceAllowsPreview(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return !coarse && !reduced;
}

function hidePreview() {
  setState({ media: null, rect: null, cardEl: null });
}

/** Card-side hook — attach the returned handlers to the hovered element. */
export function useHoverPreview(media: PreviewMedia | null) {
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRef = useRef<PreviewMedia | null>(null);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  const clear = useCallback(() => {
    if (dwellTimer.current) {
      clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (!deviceAllowsPreview() || !mediaRef.current) return;
      clear();
      // capture the element NOW — e.currentTarget is null once dispatch ends
      const el = e.currentTarget as HTMLElement;
      dwellTimer.current = setTimeout(() => {
        const anchor = el.querySelector("[data-thumb-anchor]") ?? el;
        const rect = (anchor as HTMLElement).getBoundingClientRect();
        setState({ media: mediaRef.current, rect, cardEl: el });
      }, DWELL_MS);
    },
    [clear],
  );

  const onMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      clear();
      // Exits onto our own preview layer/controls must not close the preview.
      const to = e.relatedTarget as Node | null;
      if (to && state.cardEl?.contains(to)) return;
      if (to && (to as HTMLElement).closest?.("[data-preview-layer]")) return;
      if (state.cardEl === e.currentTarget) hidePreview();
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { onMouseEnter, onMouseLeave };
}

/** The single shared preview layer — mount ONCE at the app root. */
export function HoverPreviewLayer() {
  const { media, rect, cardEl } = usePreviewStore();

  // escape closes
  useEffect(() => {
    if (!media) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hidePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media]);

  // clamp the layer to the hovered card on scroll/resize
  useEffect(() => {
    if (!media || !cardEl) return;
    let raf = 0;
    const track = () => {
      raf = requestAnimationFrame(track);
      const anchor = cardEl.querySelector("[data-thumb-anchor]") ?? cardEl;
      const next = (anchor as HTMLElement).getBoundingClientRect();
      const cur = state.rect;
      if (!cur || Math.abs(cur.top - next.top) > 0.5 || Math.abs(cur.left - next.left) > 0.5) {
        setState({ ...state, rect: next });
      }
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [media, cardEl]);

  const style = useMemo(
    () =>
      rect
        ? {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }
        : undefined,
    [rect],
  );

  if (!media || !rect) return null;

  return (
    <div
      data-preview-layer
      aria-hidden
      className="pointer-events-none fixed z-[60] overflow-hidden rounded-xl"
      style={style}
    >
      {/* keyed per media: remount resets all playback state + releases the
          previous video element (never two players) */}
      <PreviewVideo key={media.previewUrl} media={media} />
    </div>
  );
}

/** The preview player + controls. Keyed remount = clean state reset. */
function PreviewVideo({ media }: { media: PreviewMedia }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  // release the video on unmount (card left / new card / app teardown)
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, []);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || scrubbing) return;
    setProgress(v.duration ? v.currentTime / v.duration : 0);
  }, [scrubbing]);

  const seekFromPointer = useCallback((clientX: number, width: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const ratio = Math.max(0, Math.min(1, clientX / width));
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
  }, []);

  if (failed) {
    // honest failure: a small pill over the card's own static thumbnail
    return (
      <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-medium text-white/90">
        Preview unavailable
      </span>
    );
  }

  return (
    <>
      {/* the real gameplay-preview video */}
      <video
        ref={videoRef}
        src={media.previewUrl}
        muted={muted}
        autoPlay
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={() => setFailed(true)}
      />
      {/* controls take pointer events; the rest passes through */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6"
        onMouseLeave={(e) => {
          // leaving the controls back onto the card keeps the preview
          const to = e.relatedTarget as Node | null;
          if (to && state.cardEl?.contains(to)) return;
          if (to && (to as HTMLElement).closest?.("[data-preview-layer]")) return;
          hidePreview();
        }}
      >
        <button
          type="button"
          aria-label={muted ? "Unmute preview" : "Mute preview"}
          className="pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMuted((m) => !m);
          }}
        >
          {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
        <div
          role="slider"
          aria-label="Seek preview"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={-1}
          className="pointer-events-auto relative h-4 flex-1 cursor-pointer"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            setScrubbing(true);
            const r = e.currentTarget.getBoundingClientRect();
            seekFromPointer(e.clientX - r.left, r.width);
          }}
          onPointerMove={(e) => {
            if (!scrubbing) return;
            const r = e.currentTarget.getBoundingClientRect();
            seekFromPointer(e.clientX - r.left, r.width);
          }}
          onPointerUp={(e) => {
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
            setScrubbing(false);
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-pl-cyan"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
            style={{ left: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-white/85">
          {duration ? `${Math.round(progress * duration)}s / ${Math.round(duration)}s` : "—"}
        </span>
      </div>
    </>
  );
}
