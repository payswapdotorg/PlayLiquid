"use client";

/**
 * PlayLiquid client store — SPA routing for the Interface Reconstruction v2
 * shell: one web experience (sidebar + topbar + pages, including the kept
 * home feed and game pages), a full-screen creator workspace (New Task,
 * Automations, Plugins) and a settings window. Routing is hash-synced
 * ("#view=channel&channel=Data%20Slayer&game=…&spark=…") and interaction
 * state (likes, follows, saved) persists to localStorage.
 */
import { create } from "zustand";
import type { ViewName } from "@/lib/types";

const DESK_VIEWS: ViewName[] = ["newtask", "automations", "plugins", "build"];
export const DEFAULT_CHANNEL = "PlayLiquid Labs";

export function isDeskView(view: ViewName): boolean {
  return DESK_VIEWS.includes(view);
}

interface ViewState {
  view: ViewName;
  gameId: string | null;
  sparkIndex: number;
  channel: string;
  settingsOpen: boolean;
  /** transient prefill handed to the New Task composer (Create popover) */
  taskPrefill: string;
  /** search query handed to the Explore view (topbar search) */
  searchQuery: string;
}

interface InteractionState {
  likedGames: Record<string, boolean>;
  dislikedGames: Record<string, boolean>;
  followedCreators: Record<string, boolean>;
  savedGames: Record<string, boolean>;
  likedSparks: Record<string, boolean>;
}

interface NavigateOpts {
  gameId?: string | null;
  sparkIndex?: number;
  channel?: string;
  prefill?: string;
  search?: string;
}

interface PlayLiquidState extends ViewState, InteractionState {
  navigate: (view: ViewName, opts?: NavigateOpts) => void;
  openSettings: () => void;
  clearTaskPrefill: () => void;
  setSearchQuery: (q: string) => void;
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

/** Parse "#view=play&game=xyz&spark=2&channel=Name&q=…" into state. */
function viewFromHash(): ViewState {
  const view: ViewState = {
    view: "home",
    gameId: null,
    sparkIndex: 0,
    channel: DEFAULT_CHANNEL,
    settingsOpen: false,
    taskPrefill: "",
    searchQuery: "",
  };
  if (typeof window === "undefined") return view;
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return view;
  const params = new URLSearchParams(h);
  const v = params.get("view") as ViewName | null;
  if (v) view.view = v;
  view.gameId = params.get("game");
  const sp = params.get("spark");
  if (sp) view.sparkIndex = Number(sp) || 0;
  const ch = params.get("channel");
  if (ch) view.channel = ch;
  const q = params.get("q");
  if (q !== null) view.searchQuery = q;
  return view;
}

export const usePlayLiquid = create<PlayLiquidState>((set, get) => ({
  view: "home",
  gameId: null,
  sparkIndex: 0,
  channel: DEFAULT_CHANNEL,
  settingsOpen: false,
  taskPrefill: "",
  searchQuery: "",
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
    const channel = opts?.channel ?? get().channel;
    const taskPrefill = opts?.prefill ?? (isDeskView(view) ? "" : get().taskPrefill);
    const searchQuery = opts?.search !== undefined ? opts.search : view === "explore" ? get().searchQuery : "";
    set({ view, gameId, sparkIndex, channel, taskPrefill, searchQuery, settingsOpen: false });
    if (typeof window !== "undefined") {
      const params = new URLSearchParams({ view });
      if (gameId) params.set("game", gameId);
      if (sparkIndex) params.set("spark", String(sparkIndex));
      if (view === "channel") params.set("channel", channel);
      if (view === "explore" && searchQuery) params.set("q", searchQuery);
      const hash = `#${params.toString()}`;
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", hash);
      }
      // the Sparks feed keeps its own scroll position (snap stages)
      if (view !== "sparks") window.scrollTo({ top: 0 });
    }
  },

  openSettings: () => {
    set({ settingsOpen: true });
  },

  clearTaskPrefill: () => {
    set({ taskPrefill: "" });
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
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
    const parsed = viewFromHash();
    s.navigate(parsed.view, {
      gameId: parsed.gameId,
      sparkIndex: parsed.sparkIndex,
      channel: parsed.channel,
      search: parsed.searchQuery,
    });
    usePlayLiquid.setState(parsed);
  });
}
