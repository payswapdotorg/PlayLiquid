"use client";

/**
 * PlayLiquid client store — SPA view routing (hash-synced) + interaction
 * state (likes, follows, saved, watched) persisted to localStorage.
 */
import { create } from "zustand";
import type { ViewName } from "@/lib/types";

interface ViewState {
  view: ViewName;
  gameId: string | null;
  sparkIndex: number;
}

interface InteractionState {
  likedGames: Record<string, boolean>;
  dislikedGames: Record<string, boolean>;
  followedCreators: Record<string, boolean>;
  savedGames: Record<string, boolean>;
  likedSparks: Record<string, boolean>;
}

interface PlayLiquidState extends ViewState, InteractionState {
  navigate: (view: ViewName, opts?: { gameId?: string | null; sparkIndex?: number }) => void;
  toggleLikeGame: (id: string) => void;
  toggleDislikeGame: (id: string) => void;
  toggleFollow: (id: string) => void;
  toggleSave: (id: string) => void;
  toggleLikeSpark: (id: string) => void;
  hydrate: () => void;
}

const STORAGE_KEY = "playliquid-state-v1";

function readPersisted(): Partial<InteractionState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<InteractionState>;
  } catch {
    return {};
  }
}

function persist(s: PlayLiquidState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        likedGames: s.likedGames,
        dislikedGames: s.dislikedGames,
        followedCreators: s.followedCreators,
        savedGames: s.savedGames,
        likedSparks: s.likedSparks,
      }),
    );
  } catch {
    /* storage full/unavailable — ignore */
  }
}

/** Parse "#view=play&game=xyz&spark=2" into state. */
function viewFromHash(): ViewState {
  const view: ViewState = { view: "home", gameId: null, sparkIndex: 0 };
  if (typeof window === "undefined") return view;
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return view;
  const params = new URLSearchParams(h);
  const v = params.get("view") as ViewName | null;
  if (v) view.view = v;
  view.gameId = params.get("game");
  const sp = params.get("spark");
  if (sp) view.sparkIndex = Number(sp) || 0;
  return view;
}

export const usePlayLiquid = create<PlayLiquidState>((set, get) => ({
  view: "home",
  gameId: null,
  sparkIndex: 0,
  likedGames: {},
  dislikedGames: {},
  followedCreators: {},
  savedGames: {},
  likedSparks: {},

  hydrate: () => {
    set({ ...readPersisted(), ...viewFromHash() });
  },

  navigate: (view, opts) => {
    const gameId = opts?.gameId !== undefined ? opts.gameId : get().gameId;
    const sparkIndex = opts?.sparkIndex ?? get().sparkIndex;
    set({ view, gameId, sparkIndex });
    if (typeof window !== "undefined") {
      const params = new URLSearchParams({ view });
      if (gameId) params.set("game", gameId);
      if (sparkIndex) params.set("spark", String(sparkIndex));
      const hash = `#${params.toString()}`;
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", hash);
      }
      if (view !== "sparks") window.scrollTo({ top: 0 });
    }
  },

  toggleLikeGame: (id) => {
    const liked = !get().likedGames[id];
    const patch: Partial<PlayLiquidState> = { likedGames: { ...get().likedGames, [id]: liked } };
    if (liked) {
      patch.dislikedGames = { ...get().dislikedGames, [id]: false };
    }
    set(patch);
    persist(get());
  },

  toggleDislikeGame: (id) => {
    const disliked = !get().dislikedGames[id];
    const patch: Partial<PlayLiquidState> = { dislikedGames: { ...get().dislikedGames, [id]: disliked } };
    if (disliked) {
      patch.likedGames = { ...get().likedGames, [id]: false };
    }
    set(patch);
    persist(get());
  },

  toggleFollow: (id) => {
    set({ followedCreators: { ...get().followedCreators, [id]: !get().followedCreators[id] } });
    persist(get());
  },

  toggleSave: (id) => {
    set({ savedGames: { ...get().savedGames, [id]: !get().savedGames[id] } });
    persist(get());
  },

  toggleLikeSpark: (id) => {
    set({ likedSparks: { ...get().likedSparks, [id]: !get().likedSparks[id] } });
    persist(get());
  },
}));

// back/forward buttons
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const s = usePlayLiquid.getState();
    s.navigate(viewFromHash().view, {
      gameId: viewFromHash().gameId,
      sparkIndex: viewFromHash().sparkIndex,
    });
    usePlayLiquid.setState(viewFromHash());
  });
}
