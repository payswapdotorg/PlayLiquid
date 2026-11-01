"use client";

import { useHoverPreview } from "./hover-preview";
import { usePlayLiquid } from "@/lib/store";
import { formatCount } from "@/lib/format";
import type { SparkDTO } from "@/lib/types";

/**
 * One vertical 9:16 Sparks tile for the home shelf (hover previews too).
 * `index` is the tile's position in the full Sparks feed so the click
 * deep-links to the exact stage.
 */
export function SparkTile({ spark, index }: { spark: SparkDTO; index: number }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  const hover = useHoverPreview({
    previewUrl: spark.videoUrl,
    thumbnailUrl: spark.videoUrl,
    title: spark.title,
  });

  return (
    <button
      type="button"
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      onClick={() => navigate("sparks", { sparkIndex: index })}
      aria-label={`Open Sparks: ${spark.title}`}
      className="group flex w-[168px] shrink-0 cursor-pointer flex-col gap-2 text-left sm:w-[192px] lg:w-[234px] xl:w-[264px]"
    >
      <div
        data-thumb-anchor
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary"
      >
        <video
          src={spark.videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
        {spark.challenge && (
          <span className="absolute left-2 top-2 z-10 rounded bg-pl-rose/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Challenge
          </span>
        )}
        <span className="absolute bottom-2 right-2 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatCount(spark.likes)} ♥
        </span>
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{spark.title}</p>
      <p className="-mt-1 truncate text-[13px] text-muted-foreground">{spark.creator.name}</p>
    </button>
  );
}

/**
 * The home-page Sparks shelf (horizontal rail of vertical tiles).
 * `offset` is the position of `sparks[0]` in the full Sparks feed so each
 * tile deep-links to the right stage.
 */
export function SparksShelf({ sparks, offset = 0 }: { sparks: SparkDTO[]; offset?: number }) {
  if (sparks.length === 0) return null;
  return (
    <section aria-label="Sparks shelf" className="mt-2">
      <h2 className="flex items-center gap-2 px-4 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        <svg viewBox="0 0 24 24" className="size-6 fill-pl-rose" aria-hidden>
          <path d="M12 2l1.8 5.6L19.5 9l-4.6 3.6L16.3 18 12 15l-4.3 3 1.4-5.4L4.5 9l5.7-1.4L12 2z" />
        </svg>
        Sparks
      </h2>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {sparks.map((s, i) => (
          <SparkTile key={s.id} spark={s} index={offset + i} />
        ))}
      </div>
    </section>
  );
}
