/** Shared DTOs for the PlayLiquid GameOS client-server contract. */

export interface CreatorDTO {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
  followers: number;
  bio: string;
  isMe: boolean;
}

export interface GameTheme {
  palette: {
    bg: number[];
    accent: number[];
    accent2: number[];
    ball: number[];
    platform: number[];
  };
  speed: number;
  difficulty: number;
  label: string;
}

export interface GameDTO {
  id: string;
  slug: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  previewUrl: string;
  engine: string;
  creator: CreatorDTO;
  category: string;
  tags: string[];
  plays: number;
  likes: number;
  rating: number;
  durationMin: number;
  isLive: boolean;
  isUpcoming: boolean;
  version: string;
  multiplayer: string;
  controllers: string;
  status: string;
  updatedAt: string;
  /** continue-playing progress 0..1 when a session exists */
  progress?: number;
  lastScore?: number;
}

export interface GameDetailDTO extends GameDTO {
  longDescription: string;
  theme: GameTheme;
  scenes: {
    scenes: { id: string; name: string; entities: number; kind: string }[];
    assets: { id: string; name: string; kind: string; size: string }[];
    avatars: { id: string; name: string; body: string; intelligence: string }[];
  };
}

export interface SparkDTO {
  id: string;
  title: string;
  caption: string;
  videoUrl: string;
  likes: number;
  plays: number;
  challenge: string | null;
  creator: CreatorDTO;
  game: { id: string; title: string; slug: string; engine: string } | null;
  commentCount: number;
}

export interface CommentDTO {
  id: string;
  authorName: string;
  authorAvatar: string;
  body: string;
  likes: number;
  createdAt: string;
}

export interface ScoreDTO {
  id: string;
  player: string;
  avatar: string;
  score: number;
}

export interface UpdateDTO {
  id: string;
  version: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface HomeDTO {
  continuePlaying: GameDTO[];
  featured: GameDTO[];
  recommended: GameDTO[];
  trending: GameDTO[];
  live: GameDTO[];
  sparks: SparkDTO[];
  categories: string[];
}

export interface GamesPageDTO {
  games: GameDTO[];
  nextCursor: number | null;
}

export interface SparksPageDTO {
  sparks: SparkDTO[];
  nextCursor: number | null;
}

export interface StudioDTO {
  totals: { games: number; plays: number; likes: number; followers: number; sparks: number };
  myGames: GameDTO[];
  savedGames: GameDTO[];
  recentComments: (CommentDTO & { gameTitle: string })[];
  playStats: { label: string; plays: number }[];
  sparkStats: { label: string; sparkTitle: string; likes: number; plays: number }[];
}

export interface TaskDTO {
  id: string;
  prompt: string;
  model: string;
  mode: string;
  agent: string;
  status: string;
  gameId: string | null;
  gameTitle: string | null;
  gameSlug: string | null;
  summary: string | null;
  createdAt: string;
}

/** Creator channel page payload (GET /api/creators/[id]). */
export interface ChannelDTO {
  creator: CreatorDTO;
  games: GameDTO[];
  sparks: SparkDTO[];
  stats: {
    videos: number;
    sparks: number;
    followers: number;
    totalPlays: number;
    totalLikes: number;
    joinedAt: string;
  };
  recentComments: (CommentDTO & { gameTitle: string })[];
}

/** Global leaderboards payload (GET /api/leaderboards). */
export interface LeaderboardsDTO {
  topPlayers: { player: string; avatar: string; totalScore: number; runs: number; bestGame: string }[];
  topGames: GameDTO[];
}

/** Desk automation (scheduled task). */
export interface AutomationDTO {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

/** Generic preference map (settings, plugin states, notification opt-ins). */
export type SettingsValues = Record<string, string>;

/** Per-plugin install/enable state, persisted server-side. */
export interface PluginState {
  installed: boolean;
  enabled: boolean;
}
export type PluginStates = Record<string, PluginState>;

/**
 * View names across the two PlayLiquid experiences:
 * - web pages: home, sparks, play (the game page), details, channel, you,
 *   yourgames, trending, live, leaderboards, explore
 * - creator workspace (desktop): newtask, automations, plugins
 */
export type ViewName =
  | "home"
  | "play"
  | "sparks"
  | "details"
  | "channel"
  | "you"
  | "yourgames"
  | "trending"
  | "live"
  | "leaderboards"
  | "explore"
  | "newtask"
  | "automations"
  | "plugins"
  | "build";
