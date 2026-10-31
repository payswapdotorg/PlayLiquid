/**
 * PlayLiquid seed — full catalog with creators, games, sparks, comments,
 * leaderboard scores, game updates, continue-playing sessions and tasks.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Theme = {
  palette: { bg: string[]; accent: string[]; accent2: string[]; ball: string[]; platform: string[] };
  speed: number;
  difficulty: number;
  label: string;
};

const THEMES: Record<string, Theme> = {
  "neon-breaker": { palette: { bg: [7, 0, 18], accent: [0, 240, 255], accent2: [255, 0, 212], ball: [255, 255, 255], platform: [0, 240, 255] }, speed: 1, difficulty: 1, label: "Neon" },
  "crystal-smash": { palette: { bg: [2, 10, 24], accent: [126, 203, 255], accent2: [191, 233, 255], ball: [240, 250, 255], platform: [126, 203, 255] }, speed: 1.1, difficulty: 1.3, label: "Crystal" },
  "retro-bricks": { palette: { bg: [0, 0, 0], accent: [0, 255, 102], accent2: [0, 200, 80], ball: [170, 255, 204], platform: [0, 255, 102] }, speed: 0.9, difficulty: 0.8, label: "Phosphor" },
  "star-drift": { palette: { bg: [10, 6, 24], accent: [0, 229, 255], accent2: [138, 125, 255], ball: [240, 248, 255], platform: [122, 110, 150] }, speed: 1, difficulty: 1, label: "Nebula" },
  "astro-patrol": { palette: { bg: [0, 20, 8], accent: [51, 255, 119], accent2: [20, 160, 80], ball: [180, 255, 200], platform: [51, 255, 119] }, speed: 1.2, difficulty: 1.2, label: "Radar" },
  "solar-flare": { palette: { bg: [26, 8, 0], accent: [255, 154, 0], accent2: [255, 85, 0], ball: [255, 245, 230], platform: [200, 90, 20] }, speed: 1.15, difficulty: 1.25, label: "Corona" },
  "lava-leap": { palette: { bg: [20, 6, 10], accent: [255, 68, 0], accent2: [255, 120, 40], ball: [255, 210, 70], platform: [90, 60, 55] }, speed: 1, difficulty: 1, label: "Magma" },
  "cloud-hopper": { palette: { bg: [110, 170, 255], accent: [255, 255, 255], accent2: [255, 190, 100], ball: [255, 159, 67], platform: [255, 255, 255] }, speed: 0.95, difficulty: 0.85, label: "Sky" },
  "aqua-bounce": { palette: { bg: [4, 40, 58], accent: [159, 232, 255], accent2: [80, 180, 220], ball: [255, 209, 102], platform: [159, 232, 255] }, speed: 1.05, difficulty: 1.05, label: "Aqua" },
  "cyber-dash": { palette: { bg: [10, 0, 24], accent: [255, 45, 149], accent2: [0, 255, 231], ball: [0, 255, 231], platform: [60, 40, 90] }, speed: 1.2, difficulty: 1.15, label: "Cyber" },
  "pixel-racer": { palette: { bg: [0, 18, 0], accent: [0, 255, 102], accent2: [0, 180, 70], ball: [180, 255, 200], platform: [0, 90, 40] }, speed: 1.1, difficulty: 1.1, label: "Retro" },
  "void-runner": { palette: { bg: [11, 6, 32], accent: [179, 136, 255], accent2: [80, 60, 160], ball: [224, 208, 255], platform: [60, 45, 110] }, speed: 1.3, difficulty: 1.3, label: "Void" },
};

function scenesFor(title: string, category: string) {
  return JSON.stringify({
    scenes: [
      { id: "sc-1", name: "Title / Menu", entities: 6, kind: "ui" },
      { id: "sc-2", name: `${title} — Arena`, entities: 24, kind: "playfield" },
      { id: "sc-3", name: "Game Over / Results", entities: 9, kind: "ui" },
    ],
    assets: [
      { id: "as-1", name: "player-sprite.png", kind: "sprite", size: "12 KB" },
      { id: "as-2", name: `${category.toLowerCase()}-tileset.png`, kind: "tileset", size: "48 KB" },
      { id: "as-3", name: "impact-sfx.wav", kind: "audio", size: "31 KB" },
      { id: "as-4", name: "bg-parallax.png", kind: "background", size: "210 KB" },
      { id: "as-5", name: "trail-particles.png", kind: "particles", size: "8 KB" },
    ],
    avatars: [
      { id: "av-1", name: "Player One", body: "Runner frame A", intelligence: "Human-controlled" },
      { id: "av-2", name: "Rival Bot", body: "Runner frame B", intelligence: "Chases high score · medium" },
    ],
  });
}

async function main() {
  console.log("Seeding PlayLiquid…");

  // wipe (idempotent reseeding)
  await db.task.deleteMany();
  await db.score.deleteMany();
  await db.playSession.deleteMany();
  await db.comment.deleteMany();
  await db.gameUpdate.deleteMany();
  await db.spark.deleteMany();
  await db.game.deleteMany();
  await db.creator.deleteMany();

  const creators = await Promise.all([
    db.creator.create({
      data: {
        handle: "@playliquidlabs",
        name: "PlayLiquid Labs",
        avatarUrl: "/avatars/playliquid-labs.jpg",
        verified: true,
        followers: 128400,
        isMe: true,
        bio: "The official PlayLiquid studio. We build liquid-smooth instant games and the GameOS that runs them.",
      },
    }),
    db.creator.create({
      data: {
        handle: "@neonforge",
        name: "Neon Forge",
        avatarUrl: "/avatars/neon-forge.jpg",
        verified: true,
        followers: 94210,
        bio: "Forging neon arcade experiences since forever. Two thumbs, one anvil.",
      },
    }),
    db.creator.create({
      data: {
        handle: "@pixelpioneers",
        name: "Pixel Pioneers",
        avatarUrl: "/avatars/pixel-pioneers.jpg",
        verified: true,
        followers: 61750,
        bio: "8-bit hearts, 60fps minds. Classic first, modern always.",
      },
    }),
    db.creator.create({
      data: {
        handle: "@starloop",
        name: "Starloop Games",
        avatarUrl: "/avatars/starloop.jpg",
        verified: false,
        followers: 45890,
        bio: "Orbital shooters and deep-space drifters.",
      },
    }),
    db.creator.create({
      data: {
        handle: "@volcanointeractive",
        name: "Volcano Interactive",
        avatarUrl: "/avatars/volcano-interactive.jpg",
        verified: true,
        followers: 78030,
        bio: "Hot platformers, fresh out of the magma.",
      },
    }),
    db.creator.create({
      data: {
        handle: "@cloudnine",
        name: "Cloud Nine Arcade",
        avatarUrl: "/avatars/cloud-nine.jpg",
        verified: false,
        followers: 32120,
        bio: "Cozy, bouncy, family-friendly arcade joy.",
      },
    }),
  ]);
  const [me, neonForge, pixelPioneers, starloop, volcano, cloudNine] = creators;

  type GameSeed = {
    slug: string; title: string; creator: string; category: string; engine: string;
    description: string; longDescription: string; tags: string; plays: number; likes: number;
    rating: number; durationMin: number; isLive?: boolean; isUpcoming?: boolean; version: string;
    multiplayer?: string; featured?: boolean;
  };

  const gameSeeds: GameSeed[] = [
    {
      slug: "neon-breaker", title: "Neon Breaker", creator: neonForge.id, category: "Arcade", engine: "breaker",
      description: "Smash a wall of neon energy bricks with a plasma ball in this slick reimagining of the arcade classic.",
      longDescription: "Neon Breaker is a love letter to the brick-breakers of the arcade era, rebuilt with liquid-smooth 60fps physics, glow-trail plasma balls and chain-combo scoring. Clear all nine energy walls across three difficulty tiers, chase the global leaderboard, and unlock mirror-mode after your first 10k run.\n\nBuilt in 3 days on the PlayLiquid Game Builder with agent-assisted level design.",
      tags: "arcade,breakout,neon,1p,leaderboard",
      plays: 1284300, likes: 96400, rating: 4.8, durationMin: 6, version: "1.4.2", multiplayer: "Leaderboard duel", featured: true,
    },
    {
      slug: "star-drift", title: "Star Drift", creator: starloop.id, category: "Shooter", engine: "stardrift",
      description: "Drift through a violet nebula, blast incoming asteroid swarms and rack up combo multipliers.",
      longDescription: "Star Drift drops you into a hand-painted purple nebula where asteroid swarms get faster, denser and angrier every wave. Your little arrowhead fighter handles like a dream — drift, dash and return fire.\n\nWave 20 is where the community wall currently sits. The record is 31.",
      tags: "shooter,space,asteroids,1p,combo",
      plays: 982100, likes: 74200, rating: 4.7, durationMin: 8, version: "2.0.1", featured: true,
    },
    {
      slug: "lava-leap", title: "Lava Leap", creator: volcano.id, category: "Platformer", engine: "leap",
      description: "Out-climb an erupting volcano — one perfect bounce at a time. Do not touch the magma.",
      longDescription: "The volcano is awake and the magma is rising faster than your courage. Bounce from platform to platform, ride thermal updrafts and bank mid-air spins for bonus height.\n\nSimple to learn, brutal to master. The top of the world sits at 4,180m.",
      tags: "platformer,vertical,endless,1p,score",
      plays: 2105900, likes: 184300, rating: 4.9, durationMin: 5, version: "1.9.0", multiplayer: "Score race", featured: true,
    },
    {
      slug: "cyber-dash", title: "Cyber Dash", creator: me.id, category: "Runner", engine: "runner",
      description: "Sprint across neon rooftops, dodge holographic traffic and leave the syndicate in the dust.",
      longDescription: "You stole the chip. Now run. Cyber Dash is a 3-lane endless sprint across a rain-slicked neon city — slide under cargo drones, vault holographic billboards and grab data shards for multipliers.\n\nThe official PlayLiquid Labs launch title, live on GameOS.",
      tags: "runner,cyberpunk,endless,1p",
      plays: 1567800, likes: 121500, rating: 4.6, durationMin: 7, version: "1.2.0", multiplayer: "Ghost race", featured: true,
    },
    {
      slug: "crystal-smash", title: "Crystal Smash", creator: cloudNine.id, category: "Puzzle", engine: "breaker",
      description: "A chill crystal-puzzle breaker with shatter physics and 60 hand-designed caverns.",
      longDescription: "Every wall in Crystal Smash is a geode waiting to crack. Line up angle shots to trigger chain shatters and clear the cavern with as few balls as possible.\n\n60 caverns, 3-star ratings, zero timers. Pure puzzle comfort.",
      tags: "puzzle,breakout,relax,1p",
      plays: 734500, likes: 58800, rating: 4.5, durationMin: 12, version: "1.1.4",
    },
    {
      slug: "astro-patrol", title: "Astro Patrol", creator: pixelPioneers.id, category: "Shooter", engine: "stardrift",
      description: "Green-phosphor radar defense. Intercept the UFO wave before it reaches the colony.",
      longDescription: "Rendered entirely in phosphor green like the radar screens that inspired it, Astro Patrol is a defense shooter about calm hands and clean intercept angles.\n\nEndurance mode patrols forever. How long can you hold the line?",
      tags: "shooter,retro,defense,1p,endurance",
      plays: 456300, likes: 39100, rating: 4.4, durationMin: 9, version: "1.0.8",
    },
    {
      slug: "cloud-hopper", title: "Cloud Hopper", creator: cloudNine.id, category: "Platformer", engine: "leap",
      description: "The coziest vertical platformer on PlayLiquid. Bounce up an endless sunny sky.",
      longDescription: "Cloud Hopper is Lava Leap's cheerful sibling: no danger, no timer — just you, springy clouds and an endless blue sky. Perfect for a 60-second coffee break or a 60-minute zen session.\n\nRainbow trails unlock at 500m.",
      tags: "platformer,cozy,endless,1p,kids",
      plays: 891200, likes: 84700, rating: 4.7, durationMin: 5, version: "1.3.1",
    },
    {
      slug: "pixel-racer", title: "Pixel Racer", creator: pixelPioneers.id, category: "Racing", engine: "runner",
      description: "A monochrome 8-bit night race. Weave through traffic at increasingly illegal speeds.",
      longDescription: "One color. One road. Zero mercy. Pixel Racer distills arcade racing to its phosphor-green essence — weave, boost, survive.\n\nFeatures the community-favorite CRT scanline mode (on by default, obviously).",
      tags: "racing,retro,8bit,1p,endless",
      plays: 667400, likes: 51200, rating: 4.3, durationMin: 6, version: "1.0.2",
    },
    {
      slug: "void-runner", title: "Void Runner", creator: me.id, category: "Runner", engine: "runner",
      description: "An infinite violet void. A glowing silhouette. Geometric obstacles that want you gone.",
      longDescription: "Void Runner is Cyber Dash's darker, faster sibling — a hard-mode endless dash through a collapsing void. Every 1000m the geometry shifts and the pace climbs.\n\nCurrently in live playtest on PlayLiquid. Send feedback from the game page.",
      tags: "runner,hard,endless,1p,playtest",
      plays: 312900, likes: 29800, rating: 4.5, durationMin: 7, version: "0.9.3-beta", isLive: false,
    },
    {
      slug: "aqua-bounce", title: "Aqua Bounce", creator: me.id, category: "Arcade", engine: "leap",
      description: "Bounce on bubbles into the deep blue. God rays, tropical fish and one very happy diver.",
      longDescription: "Dive deep and bounce forever. Aqua Bounce is a serene deep-sea take on the vertical bouncer with bubble physics that feel like a warm bath.\n\nPressure zones add challenge past 1,000m.",
      tags: "arcade,underwater,endless,1p",
      plays: 540800, likes: 47300, rating: 4.6, durationMin: 5, version: "1.0.5",
    },
    {
      slug: "retro-bricks", title: "Retro Bricks", creator: pixelPioneers.id, category: "Arcade", engine: "breaker",
      description: "1972 called. It wants its wall back. The purest phosphor-green breaker alive.",
      longDescription: "No power-ups. No mercy. No colors beyond green. Retro Bricks is a museum-grade restoration of the very first wall — rebuilt with modern frame timing so it plays as good as you remember.\n\nThe '72 layout. The '72 speed. The '72 pain.",
      tags: "arcade,retro,breakout,classic,1p",
      plays: 1023400, likes: 88600, rating: 4.8, durationMin: 4, version: "1.0.0",
    },
    {
      slug: "solar-flare", title: "Solar Flare", creator: starloop.id, category: "Shooter", engine: "stardrift",
      description: "Skim the sun's corona, dodge flare eruptions and fry incoming comets. Hot. Very hot.",
      longDescription: "Solar Flare is the most beautiful way to overheat. White-hot visual design, escalating solar storms and a heat mechanic that rewards flying dangerously close to the flare line.\n\nCorona mode unlocks at 15,000 points.",
      tags: "shooter,space,sun,1p,leaderboard",
      plays: 423700, likes: 36400, rating: 4.4, durationMin: 8, version: "1.2.0", isUpcoming: false,
    },
  ];

  const games: Record<string, { id: string; title: string; slug: string }> = {};
  for (const g of gameSeeds) {
    const theme = THEMES[g.slug];
    const created = await db.game.create({
      data: {
        slug: g.slug,
        title: g.title,
        description: g.description,
        longDescription: g.longDescription,
        thumbnailUrl: `/covers/${g.slug}.jpg`,
        previewUrl: `/previews/${g.slug}.mp4`,
        engine: g.engine,
        themeJson: JSON.stringify(theme),
        scenesJson: scenesFor(g.title, g.category),
        creatorId: g.creator,
        category: g.category,
        tags: g.tags,
        plays: g.plays,
        likes: g.likes,
        rating: g.rating,
        durationMin: g.durationMin,
        isLive: g.isLive ?? false,
        isUpcoming: g.isUpcoming ?? false,
        version: g.version,
        multiplayer: g.multiplayer ?? "",
        controllers: "Keyboard, Touch, Gamepad",
        status: "published",
      },
    });
    games[g.slug] = { id: created.id, title: g.title, slug: g.slug };
  }

  // ---- game updates (changelog) ----
  const updates: [string, string, string, string][] = [
    ["neon-breaker", "1.4.2", "Mirror Mode + combo tuning", "Mirror Mode is live — every wall flipped, scores doubled. Chain combo window extended by 120ms based on playtest feedback. Fixed a rare ball-tunneling bug at 240fps."],
    ["neon-breaker", "1.4.0", "Mirror Mode (beta)", "Opt-in beta for the long-requested mirrored layouts. Leaderboard split into Classic and Mirror."],
    ["lava-leap", "1.9.0", "Thermal updrafts", "Ride rising heat columns for bonus height. Spin-bonus now banks mid-air. Magma speed retuned after the 4,000m world record."],
    ["star-drift", "2.0.1", "Wave 31 balance", "Asteroid density curve softened past wave 25 — the record chase continues. Added Nebula Bloom visual set (free)."],
    ["cyber-dash", "1.2.0", "Ghost Race", "Race against the ghost of your best run. Data shard multipliers now stack to x8. New rooftop: the Foundry."],
    ["cloud-hopper", "1.3.1", "Rainbow trails", "Unlock rainbow trails at 500m. Spring clouds now squish properly (very important)."],
  ];
  for (const [slug, version, title, body] of updates) {
    await db.gameUpdate.create({
      data: { gameId: games[slug].id, version, title, body },
    });
  }

  // ---- sparks ----
  const commenters = [
    ["GlitchQueen", "/avatars/playliquid-labs.jpg"],
    ["ByteBandit", "/avatars/neon-forge.jpg"],
    ["Nova", "/avatars/starloop.jpg"],
    ["RetroRita", "/avatars/pixel-pioneers.jpg"],
    ["MagmaMike", "/avatars/volcano-interactive.jpg"],
    ["Skye", "/avatars/cloud-nine.jpg"],
  ];

  type SparkSeed = { id: string; slug: string; title: string; caption: string; game: string; creator: string; likes: number; challenge?: string };
  const sparkSeeds: SparkSeed[] = [
    { id: "sp1", slug: "neon-breaker-clip", title: "10-chain combo 🔥", caption: "TEN-brick chain in Neon Breaker — the sound design carries this one ngl", game: "neon-breaker", creator: neonForge.id, likes: 48200, challenge: "Beat my combo: 10-chain" },
    { id: "sp2", slug: "star-drift-clip", title: "Wave 22 no-hit run", caption: "Wave 22 with ZERO hits. My hands were shaking by the end 😅", game: "star-drift", creator: starloop.id, likes: 39800, challenge: "Survive wave 20+" },
    { id: "sp3", slug: "lava-leap-clip", title: "3,980m death jump", caption: "SO close to 4k in Lava Leap. The magma got me at 3,980m 💀", game: "lava-leap", creator: volcano.id, likes: 71500, challenge: "Beat my height: 3,980m" },
    { id: "sp4", slug: "cyber-dash-clip", title: "x8 shard multiplier", caption: "Full x8 data-shard stack through the Foundry rooftop. Cyber Dash is UNREAL", game: "cyber-dash", creator: me.id, likes: 56300, challenge: "Stack x8, survive 30s" },
    { id: "sp5", slug: "cloud-hopper-clip", title: "Zen mode 🌈", caption: "500m of pure calm. Rainbow trail unlocked ✨ (no audio, just vibes)", game: "cloud-hopper", creator: cloudNine.id, likes: 33400 },
    { id: "sp6", slug: "solar-flare-clip", title: "Corona skim at 15k", caption: "Skimming the flare line for the heat bonus. Worth it. Mostly.", game: "solar-flare", creator: starloop.id, likes: 27600, challenge: "Hit 15,000 pts" },
    { id: "sp7", slug: "aqua-bounce-clip", title: "Pressure zone 1,200m", caption: "The deep zone in Aqua Bounce changes EVERYTHING — bubbles get squishy", game: "aqua-bounce", creator: me.id, likes: 19800, challenge: "Dive past 1,000m" },
    { id: "sp8", slug: "retro-bricks-clip", title: "The '72 wall", caption: "Beating Retro Bricks on one life. Grandpa says we're soft. He's right.", game: "retro-bricks", creator: pixelPioneers.id, likes: 42100, challenge: "Clear 3 walls, 1 life" },
    { id: "sp9", slug: "void-runner-clip", title: "Void shifts at 2,000m", caption: "Past 2k the void RUNS. Playtest build 0.9.3 — feedback welcome 👇", game: "void-runner", creator: me.id, likes: 16200, challenge: "Reach the first shift" },
  ];
  for (const s of sparkSeeds) {
    await db.spark.create({
      data: {
        id: s.id,
        title: s.title,
        caption: s.caption,
        videoUrl: `/previews/sparks/${s.slug}.mp4`,
        thumbnailUrl: `/previews/sparks/${s.slug}.mp4`,
        gameId: games[s.game].id,
        creatorId: s.creator,
        likes: s.likes,
        plays: Math.round(s.likes * 6.4),
        challenge: s.challenge ?? null,
      },
    });
  }

  // ---- comments on games ----
  const gameComments: [string, string, string][] = [
    ["neon-breaker", "GlitchQueen", "The chain-combo sound is criminal levels of satisfying. 34k on Mirror wall 4 — come beat me."],
    ["neon-breaker", "ByteBandit", "Played this for '5 minutes' and lost a weekend. 10/10 would lose again."],
    ["neon-breaker", "RetroRita", "Finally a breaker where the paddle doesn't feel like it's on ice. Physics team ate."],
    ["lava-leap", "MagmaMike", "1.9 updrafts changed my whole route. New PB 4,012m — the record is legitimately in reach now."],
    ["lava-leap", "Skye", "My 6yo plays this on Cloud Hopper mode and I play it on normal and we're both obsessed 😂"],
    ["star-drift", "Nova", "Wave 22. WAVE. TWENTY. TWO. The density past 25 is psychological warfare but I love it."],
    ["star-drift", "GlitchQueen", "Nebula Bloom skin is free?? Neon Forge/Starloop really said 'have art for free' 😭"],
    ["cyber-dash", "ByteBandit", "Ghost Race against my own best run is the most motivating feature added to a runner all year."],
    ["cyber-dash", "Nova", "The Foundry rooftop soundtrack goes hard. Also I have never once survived the cargo drone section."],
    ["cloud-hopper", "Skye", "Spring clouds squishing 'properly' is the patch note of the year. They were RIGHT."],
    ["retro-bricks", "RetroRita", "One color. One road— sorry, one wall. Museum-grade is exactly right. It HURTS."],
    ["solar-flare", "Nova", "Heat bonus for skimming the flare line is genius risk design. My palms are sweating at 14k."],
    ["crystal-smash", "Skye", "Zero timers, three stars, 60 caverns. This is my Sunday morning now."],
    ["pixel-racer", "RetroRita", "The scanline mode being on by default is the correct opinion. Love the monochrome soul."],
    ["void-runner", "ByteBandit", "0.9.3 shifts are scary good. Feels like the void is learning. More platforms past 2k please!"],
  ];
  for (const [slug, author, body] of gameComments) {
    const av = commenters.find((c) => c[0] === author)?.[1] ?? "/avatars/playliquid-labs.jpg";
    await db.comment.create({
      data: {
        gameId: games[slug].id,
        authorName: author,
        authorAvatar: av,
        body,
        likes: Math.floor(Math.random() * 900) + 40,
      },
    });
  }

  // ---- comments on sparks ----
  const sparkComments: [string, string, string][] = [
    ["sp1", "ByteBandit", "the ANGLE on brick 7. absolute filth 🔥"],
    ["sp1", "RetroRita", "combo: 11-chain. your move 👀"],
    ["sp3", "GlitchQueen", "3,980m… the magma literally breathed on you at the end"],
    ["sp3", "MagmaMike", "updraft at 3,900m was RIGHT THERE"],
    ["sp4", "Nova", "x8 through Foundry is elite. took me 40 tries to even stack x6"],
    ["sp2", "GlitchQueen", "no-hit wave 22 and you didn't even blink. machine."],
    ["sp8", "MagmaMike", "'grandpa says we're soft' I FELT that"],
    ["sp9", "Skye", "the void shift at 2k genuinely startled me. playtest feedback: MORE"],
  ];
  for (const [sparkId, author, body] of sparkComments) {
    const av = commenters.find((c) => c[0] === author)?.[1] ?? "/avatars/playliquid-labs.jpg";
    await db.comment.create({
      data: { sparkId, authorName: author, authorAvatar: av, body, likes: Math.floor(Math.random() * 800) + 25 },
    });
  }

  // ---- leaderboard scores ----
  const players: [string, string][] = [
    ["GlitchQueen", "/avatars/playliquid-labs.jpg"],
    ["ByteBandit", "/avatars/neon-forge.jpg"],
    ["Nova", "/avatars/starloop.jpg"],
    ["RetroRita", "/avatars/pixel-pioneers.jpg"],
    ["MagmaMike", "/avatars/volcano-interactive.jpg"],
    ["Skye", "/avatars/cloud-nine.jpg"],
    ["PixelPaladin", "/avatars/pixel-pioneers.jpg"],
    ["DriftKing", "/avatars/starloop.jpg"],
    ["ComboCat", "/avatars/neon-forge.jpg"],
    ["LiquidPro", "/avatars/playliquid-labs.jpg"],
  ];
  const scoreSeeds: [string, number[]][] = [
    ["neon-breaker", [41250, 38900, 36400, 34100, 32800, 29400, 27100, 25300, 22800, 20600]],
    ["lava-leap", [4180, 4012, 3960, 3740, 3510, 3320, 3140, 2980, 2750, 2540]],
    ["star-drift", [31200, 28450, 26100, 24800, 22300, 20600, 18900, 17400, 15800, 14200]],
    ["cyber-dash", [28900, 26400, 24100, 22600, 20800, 19300, 17900, 16400, 14800, 13500]],
    ["cloud-hopper", [3140, 2980, 2870, 2650, 2430, 2290, 2140, 1980, 1860, 1720]],
    ["retro-bricks", [18900, 17200, 15800, 14600, 13900, 12800, 11700, 10800, 9900, 8800]],
    ["solar-flare", [17800, 16400, 15200, 14100, 13300, 12200, 11400, 10600, 9700, 8900]],
    ["pixel-racer", [15200, 14100, 13300, 12400, 11800, 10900, 10200, 9400, 8700, 8100]],
  ];
  for (const [slug, scores] of scoreSeeds) {
    for (let i = 0; i < scores.length; i++) {
      const [name, av] = players[i % players.length];
      await db.score.create({
        data: { gameId: games[slug].id, player: name, avatar: av, score: scores[i] },
      });
    }
  }

  // ---- continue playing sessions (last played by "me") ----
  const sessions: [string, number, number][] = [
    ["lava-leap", 0.62, 2840],
    ["neon-breaker", 0.38, 19400],
    ["cyber-dash", 0.81, 22100],
    ["star-drift", 0.29, 15600],
  ];
  for (const [slug, progress, score] of sessions) {
    await db.playSession.create({
      data: { gameId: games[slug].id, progress, lastScore: score },
    });
  }

  // ---- historical tasks ----
  await db.task.createMany({
    data: [
      {
        prompt: "Build a cyberpunk endless runner with 3-lane dodging, data-shard multipliers and a ghost-race mode. Neon city rooftop setting.",
        model: "GLM-4.6",
        mode: "Create",
        agent: "Game Architect",
        status: "completed",
        gameId: games["cyber-dash"].id,
        resultJson: JSON.stringify({ summary: "Created Cyber Dash v1.2.0 with runner engine, cyber theme, 3 lanes, ghost race." }),
      },
      {
        prompt: "Make a harder, faster variant of Cyber Dash set in a collapsing void. Geometric obstacles, difficulty that shifts every 1000m.",
        model: "GLM-4.6",
        mode: "Iterate",
        agent: "Game Architect",
        status: "completed",
        gameId: games["void-runner"].id,
        resultJson: JSON.stringify({ summary: "Created Void Runner 0.9.3-beta playtest with void theme and shift mechanic." }),
      },
    ],
  });

  console.log("Seed complete:", {
    creators: creators.length,
    games: gameSeeds.length,
    sparks: sparkSeeds.length,
    updates: updates.length,
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
