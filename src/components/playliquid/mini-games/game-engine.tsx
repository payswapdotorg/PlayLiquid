"use client";

/**
 * PlayLiquid live game engine — four real playable engines (breaker, stardrift,
 * leap, runner) themed by each game's themeJson so the playable build matches
 * its preview assets. Supports:
 * - keyboard (arrows / WASD / space), mouse and touch input
 * - HUD via DOM overlay (score, lives, game-over card)
 * - attract/demo mode (auto=true) for the Game Builder live canvas
 * - score/progress/game-over callbacks for sessions + leaderboards
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GameTheme } from "@/lib/types";

const W = 800;
const H = 450;

export interface GameEngineHandle {
  restart: () => void;
}

type EngineProps = {
  engine: string;
  theme: GameTheme;
  auto?: boolean;
  paused?: boolean;
  onScore?: (score: number) => void;
  onGameOver?: (score: number) => void;
  onProgress?: (progress: number) => void;
  restartKey?: number;
  className?: string;
};

type RGB = number[];
const rgb = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function defaultTheme(): GameTheme {
  return {
    palette: {
      bg: [10, 6, 24],
      accent: [0, 229, 255],
      accent2: [138, 125, 255],
      ball: [240, 248, 255],
      platform: [122, 110, 150],
    },
    speed: 1,
    difficulty: 1,
    label: "Default",
  };
}

export function GameEngine({
  engine,
  theme: themeProp,
  auto = false,
  paused = false,
  onScore,
  onGameOver,
  onProgress,
  restartKey = 0,
  className,
}: EngineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hudScore, setHudScore] = useState(0);
  const [hudLives, setHudLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(auto);

  const theme = themeProp?.palette ? themeProp : defaultTheme();
  const speed = Math.max(0.5, Math.min(1.8, themeProp?.speed ?? 1));
  const difficulty = Math.max(0.5, Math.min(1.8, themeProp?.difficulty ?? 1));

  const stateRef = useRef<Record<string, unknown>>({});
  const keysRef = useRef<Record<string, boolean>>({});
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const reportedOver = useRef(false);
  const rafRef = useRef(0);
  const scoreReport = useRef(0);

  const makeState = useCallback(() => {
    const s: Record<string, unknown> = { score: 0, lives: 3, t: 0, maxScore: 0, dead: false };
    if (engine === "breaker") {
      s.paddleX = W / 2;
      s.ballX = W / 2;
      s.ballY = H * 0.6;
      const ang = -Math.PI / 3;
      const sp = 5.6 * speed;
      s.ballVX = Math.cos(ang) * sp;
      s.ballVY = Math.sin(ang) * sp;
      s.bricks = [];
      const cols = 10;
      const rows = 5;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) s.bricks.push({ x: 60 + c * 68, y: 60 + r * 34, hp: 1 });
      s.paddleW = 120 / difficulty;
      s.wall = 1;
      s.destroyed = 0;
      s.totalBricks = cols * rows;
    } else if (engine === "stardrift") {
      s.shipX = W / 2;
      s.asteroids = [];
      s.bullets = [];
      s.spawn = 0;
      s.shootT = 0;
    } else if (engine === "leap") {
      s.px = W / 2;
      s.py = H * 0.5;
      s.vx = 0;
      s.vy = -640 * speed;
      s.platforms = [];
      for (let i = 0; i < 8; i++)
        s.platforms.push({ x: 40 + Math.random() * (W - 180), y: H - 30 - i * 52, w: 110 });
      s.camY = 0;
      s.height = 0;
      s.lavaY = H + 80;
      s.lives = 1;
    } else {
      // runner
      s.lane = 1;
      s.laneX = W / 2;
      s.obstacles = [];
      s.spawn = 0;
      s.dist = 0;
      s.lives = 1;
    }
    return s;
  }, [engine, speed, difficulty]);

  // reset when the restart key or engine changes (render-time state reset +
  // engine-state rebuild in a matching effect). makeState rides a ref so theme
  // slider changes never restart the run — only explicit resets do.
  const [prevReset, setPrevReset] = useState(`${restartKey}:${engine}`);
  if (prevReset !== `${restartKey}:${engine}`) {
    setPrevReset(`${restartKey}:${engine}`);
    setHudScore(0);
    setHudLives(engine === "runner" ? 1 : 3);
    setGameOver(false);
    setStarted(auto);
  }
  const makeStateRef = useRef(makeState);
  useEffect(() => {
    makeStateRef.current = makeState;
  }, [makeState]);
  useEffect(() => {
    stateRef.current = makeStateRef.current();
    reportedOver.current = false;
  }, [prevReset]);

  const restart = useCallback(() => {
    stateRef.current = makeState();
    reportedOver.current = false;
    setHudScore(0);
    setHudLives(engine === "runner" ? 1 : 3);
    setGameOver(false);
    setStarted(true);
  }, [engine, makeState]);

  // input
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true;
      if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  const gameOverFor = useCallback(
    (score: number) => {
      if (reportedOver.current) return;
      reportedOver.current = true;
      setGameOver(true);
      onGameOver?.(Math.round(score));
    },
    [onGameOver],
  );

  // throttled HUD updates — only when values actually change
  const hudRef = useRef({ score: -1, lives: -1 });
  const hud = useCallback(
    (score: number, lives: number) => {
      if (hudRef.current.score !== score || hudRef.current.lives !== lives) {
        hudRef.current = { score, lives };
        setHudScore(score);
        setHudLives(lives);
        onScore?.(score);
      }
    },
    [onScore],
  );

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let last = performance.now();
    let lastProgress = -1;

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current as Record<string, any>;
      if (!s || paused) {
        renderIdle(ctx);
        return;
      }
      s.t += dt;

      // ---------------- update ----------------
      const keys = keysRef.current;
      const pointer = pointerRef.current;
      if (!started && !auto) {
        renderIdle(ctx);
        return;
      }

      const progressOf = (sc: number) => {
        if (engine === "breaker") return Math.min(0.98, (s.destroyed ?? 0) / ((s.totalBricks ?? 50) * 3));
        if (engine === "stardrift") return Math.min(0.98, sc / 30000);
        if (engine === "leap") return Math.min(0.98, sc / 4200);
        return Math.min(0.98, sc / 25000);
      };
      const wrappedHud = (sc: number, lives: number) => {
        hud(sc, lives);
        const p = progressOf(sc);
        if (p !== lastProgress) {
          lastProgress = p;
          onProgress?.(p);
        }
      };

      if (engine === "breaker") updateBreaker(s, dt, keys, pointer, auto, speed, difficulty, wrappedHud, (finalScore) => gameOverFor(finalScore));
      if (engine === "stardrift") updateStardrift(s, dt, keys, pointer, auto, speed, difficulty, wrappedHud, (finalScore) => gameOverFor(finalScore));
      if (engine === "leap") updateLeap(s, dt, keys, pointer, auto, speed, difficulty, wrappedHud, (finalScore) => gameOverFor(finalScore));
      if (engine === "runner") updateRunner(s, dt, keys, pointer, auto, speed, difficulty, wrappedHud, (finalScore) => gameOverFor(finalScore));

      // ---------------- render ----------------
      renderFrame(ctx, s, engine, theme);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
     
  }, [engine, theme, started, auto, paused, speed, difficulty]);

  const onPointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    onPointer(e);
    swipeStart.current = { x: e.clientX, y: e.clientY };
    if (!started && !auto) setStarted(true);
  }, [onPointer, started, auto]);
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = swipeStart.current;
      swipeStart.current = null;
      if (!st || engine !== "runner") return;
      const dx = e.clientX - st.x;
      const s = stateRef.current as Record<string, any>;
      if (Math.abs(dx) > 24) {
        s.lane = Math.max(0, Math.min(2, s.lane + (dx > 0 ? 1 : -1)));
      }
    },
    [engine],
  );

  return (
    <div className={cn("relative aspect-video w-full select-none overflow-hidden rounded-xl bg-black", className)}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="pl-canvas absolute inset-0 h-full w-full"
        onPointerMove={onPointer}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
        aria-label={`${engine} game canvas`}
      />
      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 font-mono text-sm font-bold tabular-nums text-white drop-shadow">
        <span className="rounded bg-black/40 px-2 py-0.5">{hudScore.toLocaleString()}</span>
        <span className="flex items-center gap-1 rounded bg-black/40 px-2 py-0.5">
          {Array.from({ length: Math.max(0, hudLives) }).map((_, i) => (
            <Heart key={i} className="size-3.5 fill-pl-rose text-pl-rose" aria-hidden />
          ))}
        </span>
      </div>
      {!auto && !started && !gameOver && (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[2px]"
        >
          <span className="flex size-16 items-center justify-center rounded-full pl-1 pl-brand-gradient text-2xl text-black shadow-lg pl-glow">
            ▶
          </span>
          <span className="rounded-full bg-black/60 px-4 py-1.5 text-sm text-white">
            Click or press Space to play · ←→ move
          </span>
        </button>
      )}
      {gameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm pl-fade-up">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/60">Game over</p>
          <p className="font-mono text-4xl font-bold tabular-nums text-white">
            {hudScore.toLocaleString()}
          </p>
          <button
            type="button"
            onClick={restart}
            className="flex cursor-pointer items-center gap-2 rounded-full pl-brand-gradient px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
            <RotateCcw className="size-4" /> Play again
          </button>
          {auto && null}
        </div>
      )}
    </div>
  );
}

/* ================= engine updates ================= */

type HudCb = (score: number, lives: number) => void;
type OverCb = (score: number) => void;

function updateBreaker(
  s: any, dt: number, keys: Record<string, boolean>, pointer: { x: number; y: number } | null,
  auto: boolean, speed: number, difficulty: number, hud: HudCb, over: OverCb,
) {
  const PW = s.paddleW;
  const PY = H - 34;
  // paddle control
  let target = s.paddleX;
  if (auto) {
    target = s.ballX + (s.ballVX > 0 ? 26 : -26);
  } else if (pointer) {
    target = pointer.x;
  } else if (keys["ArrowLeft"] || keys["a"]) target = s.paddleX - 640 * dt;
  else if (keys["ArrowRight"] || keys["d"]) target = s.paddleX + 640 * dt;
  s.paddleX = lerp(s.paddleX, Math.max(PW / 2, Math.min(W - PW / 2, target)), auto ? 0.12 : 0.35);

  // ball
  s.ballX += s.ballVX * 60 * dt;
  s.ballY += s.ballVY * 60 * dt;
  if (s.ballX < 10) { s.ballX = 10; s.ballVX = Math.abs(s.ballVX); }
  if (s.ballX > W - 10) { s.ballX = W - 10; s.ballVX = -Math.abs(s.ballVX); }
  if (s.ballY < 10) { s.ballY = 10; s.ballVY = Math.abs(s.ballVY); }

  // paddle bounce
  if (s.ballY > PY - 8 && s.ballY < PY + 8 && s.ballVY > 0 && Math.abs(s.ballX - s.paddleX) < PW / 2 + 6) {
    s.ballVY = -Math.abs(s.ballVY);
    const off = (s.ballX - s.paddleX) / (PW / 2);
    s.ballVX = off * 5.2 * speed;
  }

  // bricks
  if (s.bricks.length > 0) {
    for (let i = s.bricks.length - 1; i >= 0; i--) {
      const b = s.bricks[i];
      if (s.ballX > b.x && s.ballX < b.x + 64 && s.ballY > b.y && s.ballY < b.y + 28) {
        s.bricks.splice(i, 1);
        s.destroyed = (s.destroyed ?? 0) + 1;
        s.score += 100;
        s.ballVY = -s.ballVY;
        break;
      }
    }
  }
  if (s.bricks.length === 0) {
    // next wall
    s.wall++;
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 10; c++) s.bricks.push({ x: 60 + c * 68, y: 60 + r * 34, hp: 1 });
    s.ballVX *= 1.08;
    s.ballVY = -Math.abs(s.ballVY) * 1.08;
    s.ballX = W / 2;
    s.ballY = H * 0.6;
  }

  // miss
  if (s.ballY > H + 16) {
    s.lives--;
    if (s.lives <= 0) {
      hud(s.score, 0);
      over(s.score);
      s.dead = true;
    } else {
      s.ballX = W / 2;
      s.ballY = H * 0.6;
      s.ballVY = -Math.abs(s.ballVY);
      s.ballVX = (Math.random() > 0.5 ? 1 : -1) * 3.4 * speed;
    }
  }
  if (s.dead) { s.ballX = W / 2; s.ballY = H * 0.72; }
  hud(s.score, s.lives);
}

function updateStardrift(
  s: any, dt: number, keys: Record<string, boolean>, pointer: { x: number; y: number } | null,
  auto: boolean, speed: number, difficulty: number, hud: HudCb, over: OverCb,
) {
  // ship control
  let target = s.shipX;
  if (auto) {
    // dodge nearest asteroid
    let danger = null as any;
    for (const a of s.asteroids) if (a.y > H * 0.35 && a.y < H && Math.abs(a.x - s.shipX) < 90 && (!danger || a.y > danger.y)) danger = a;
    if (danger) target = s.shipX + (danger.x > s.shipX ? -150 : 150);
    else target = W / 2 + Math.sin(s.t * 0.7) * 200;
  } else if (pointer) {
    target = pointer.x;
  } else if (keys["ArrowLeft"] || keys["a"]) target = s.shipX - 560 * dt;
  else if (keys["ArrowRight"] || keys["d"]) target = s.shipX + 560 * dt;
  s.shipX = lerp(s.shipX, Math.max(24, Math.min(W - 24, target)), auto ? 0.1 : 0.4);

  // shooting
  s.shootT -= dt;
  if (s.shootT <= 0) {
    s.shootT = 0.24 / speed;
    s.bullets.push({ x: s.shipX, y: H - 66 });
  }

  // spawn asteroids
  s.spawn -= dt;
  if (s.spawn <= 0) {
    s.spawn = Math.max(0.16, (0.7 - s.score / 60000) / difficulty) / speed;
    const r = 12 + Math.random() * 20;
    s.asteroids.push({ x: 20 + Math.random() * (W - 40), y: -r - 10, r, vy: (110 + Math.random() * 120 + s.score / 120) * speed * difficulty, rot: Math.random() * 6 });
  }

  // bullets
  for (let i = s.bullets.length - 1; i >= 0; i--) {
    s.bullets[i].y -= 620 * dt;
    if (s.bullets[i].y < -14) s.bullets.splice(i, 1);
  }

  // asteroids
  for (let i = s.asteroids.length - 1; i >= 0; i--) {
    const a = s.asteroids[i];
    a.y += a.vy * dt;
    a.rot += dt;
    if (a.y > H + 30) { s.asteroids.splice(i, 1); continue; }
    // bullet hit
    let hit = false;
    for (let j = s.bullets.length - 1; j >= 0; j--) {
      if (Math.hypot(s.bullets[j].x - a.x, s.bullets[j].y - a.y) < a.r + 4) {
        s.bullets.splice(j, 1);
        s.asteroids.splice(i, 1);
        s.score += 25;
        hit = true;
        break;
      }
    }
    if (hit) continue;
    // ship collision
    if (Math.hypot(s.shipX - a.x, H - 56 - a.y) < a.r + 14) {
      s.asteroids.splice(i, 1);
      s.lives--;
      if (s.lives <= 0) { hud(s.score, 0); over(s.score); s.dead = true; }
    }
  }
  hud(s.score, s.lives);
}

function updateLeap(
  s: any, dt: number, keys: Record<string, boolean>, pointer: { x: number; y: number } | null,
  auto: boolean, speed: number, difficulty: number, hud: HudCb, over: OverCb,
) {
  const G = 1750 * speed;
  // horizontal control
  let target = s.px;
  if (auto) {
    // aim for nearest platform below
    let best = null as any;
    for (const p of s.platforms) if (p.y > s.py && p.y < s.py + 160 && (!best || p.y < best.y)) best = p;
    target = best ? best.x + best.w / 2 : s.px;
  } else if (pointer) {
    target = pointer.x;
  } else if (keys["ArrowLeft"] || keys["a"]) target = s.px - 460 * dt;
  else if (keys["ArrowRight"] || keys["d"]) target = s.px + 460 * dt;
  s.px = lerp(s.px, Math.max(12, Math.min(W - 12, target)), auto ? 0.14 : 0.5);

  // vertical physics
  s.vy += G * dt;
  s.py += s.vy * dt;

  // platform bounce (screen-space)
  if (s.vy > 0) {
    for (const p of s.platforms) {
      if (s.px > p.x - 8 && s.px < p.x + p.w + 8 && s.py + 14 >= p.y && s.py + 14 <= p.y + 16) {
        s.vy = -640 * speed;
        break;
      }
    }
  }

  // camera up: keep player at 55% height
  const focus = H * 0.55;
  if (s.py < focus) {
    const dy = focus - s.py;
    s.py = focus;
    s.height += dy;
    for (const p of s.platforms) p.y += dy;
    s.score = Math.max(s.score, Math.round(s.height / 10));
  }

  // recycle platforms
  for (let i = 0; i < s.platforms.length; i++) {
    const p = s.platforms[i];
    if (p.y > H + 30) {
      const highest = Math.min(...s.platforms.map((q: any) => q.y));
      p.y = highest - 50 - Math.random() * 26;
      p.x = 30 + Math.random() * (W - 170);
      p.w = Math.max(72, 116 - s.height / 60) / 1;
    }
  }

  // lava rises as height grows
  s.lavaY = H + 60 - Math.min(H * 0.55, s.height * 0.05 * difficulty) - (s.t * 6 * speed * difficulty);
  if (s.py + 12 > s.lavaY) {
    hud(s.score, 0);
    over(s.score);
    s.dead = true;
  }
  hud(s.score, s.lives ?? 1);
}

function updateRunner(
  s: any, dt: number, keys: Record<string, boolean>, _pointer: { x: number; y: number } | null,
  auto: boolean, speed: number, difficulty: number, hud: HudCb, over: OverCb,
) {
  const laneX = (l: number) => W / 2 + (l - 1) * 150;
  // lane control
  if (auto) {
    // pick safest lane
    const danger = [0, 1, 2].map((l) => s.obstacles.some((o: any) => o.lane === l && o.x < W * 0.55 && o.x > 100));
    if (danger[s.lane]) {
      const safe = danger.findIndex((d) => !d);
      if (safe !== -1) s.lane = safe;
    }
  } else {
    if (keys["ArrowLeft"] || keys["a"]) { if (!s.leftHeld) { s.lane = Math.max(0, s.lane - 1); s.leftHeld = true; } }
    else s.leftHeld = false;
    if (keys["ArrowRight"] || keys["d"]) { if (!s.rightHeld) { s.lane = Math.min(2, s.lane + 1); s.rightHeld = true; } }
    else s.rightHeld = false;
  }
  s.laneX = lerp(s.laneX, laneX(s.lane), 0.25);

  // spawn
  s.spawn -= dt;
  const v = (430 + s.dist * 0.35) * speed * difficulty;
  if (s.spawn <= 0) {
    s.spawn = Math.max(0.32, 1.05 - s.dist / 9000);
    const lane = Math.floor(Math.random() * 3);
    if (!s.obstacles.some((o: any) => o.lane === lane && o.x > W - 160)) {
      s.obstacles.push({ x: W + 40, lane });
    }
  }

  // obstacles
  for (let i = s.obstacles.length - 1; i >= 0; i--) {
    const o = s.obstacles[i];
    o.x -= v * dt;
    if (o.x < -60) { s.obstacles.splice(i, 1); s.score += 60; s.dist += 42; continue; }
    if (o.lane === s.lane && Math.abs(o.x - s.laneX) < 46) {
      hud(s.score, 0);
      over(s.score);
      s.dead = true;
    }
  }
  s.dist += v * dt * 0.1;
  s.score = Math.max(s.score, Math.round(s.dist));
  hud(s.score, 1);
}

/* ================= rendering ================= */

function renderIdle(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, W, H);
}

function renderFrame(ctx: CanvasRenderingContext2D, s: any, engine: string, theme: GameTheme) {
  const P = theme.palette;
  ctx.save();
  ctx.fillStyle = rgb(P.bg);
  ctx.fillRect(0, 0, W, H);

  ctx.shadowBlur = 14;
  ctx.shadowColor = rgb(P.accent, 0.8);

  if (engine === "breaker") {
    // grid floor
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgb(P.accent, 0.1);
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(0, H * 0.8 + i * 16);
      ctx.lineTo(W, H * 0.8 + i * 16);
      ctx.stroke();
    }
    // bricks
    s.bricks.forEach((b: any, i: number) => {
      ctx.shadowBlur = 12;
      ctx.shadowColor = rgb(i % 2 ? P.accent2 : P.accent, 0.7);
      ctx.fillStyle = rgb(i % 2 ? P.accent2 : P.accent, 0.95);
      ctx.fillRect(b.x, b.y, 64, 28);
    });
    // paddle
    ctx.shadowColor = rgb(P.platform);
    ctx.fillStyle = rgb(P.platform);
    ctx.fillRect(s.paddleX - s.paddleW / 2, H - 34, s.paddleW, 12);
    // ball + trail
    ctx.shadowBlur = 18;
    ctx.shadowColor = rgb(P.ball);
    ctx.fillStyle = rgb(P.ball);
    ctx.beginPath();
    ctx.arc(s.ballX, s.ballY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(P.ball, 0.18);
    ctx.beginPath();
    ctx.arc(s.ballX - s.ballVX * 2.2, s.ballY - s.ballVY * 2.2, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (engine === "stardrift") {
    // stars
    ctx.shadowBlur = 0;
    for (let i = 0; i < 70; i++) {
      const x = (i * 173) % W;
      const y = (i * 97 + s.t * (30 + (i % 5) * 26)) % H;
      ctx.fillStyle = `rgba(210,220,255,${0.2 + (i % 5) * 0.12})`;
      ctx.fillRect(x, y, 2, 2);
    }
    // nebula
    const g = ctx.createRadialGradient(W * 0.72, H * 0.3, 20, W * 0.72, H * 0.3, W * 0.36);
    g.addColorStop(0, rgb(P.accent2, 0.1));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // bullets
    ctx.shadowBlur = 12;
    ctx.shadowColor = rgb(P.accent);
    ctx.fillStyle = rgb(P.ball);
    s.bullets.forEach((b: any) => ctx.fillRect(b.x - 2, b.y - 12, 4, 14));
    // asteroids
    ctx.shadowColor = rgb(P.platform);
    s.asteroids.forEach((a: any) => {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot * 0.4);
      ctx.fillStyle = rgb(P.platform, 0.95);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const rr = a.r * (0.72 + ((k * 29) % 10) / 26);
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    // ship
    ctx.shadowColor = rgb(P.accent);
    ctx.fillStyle = rgb(P.ball);
    ctx.beginPath();
    ctx.moveTo(s.shipX, H - 78);
    ctx.lineTo(s.shipX - 18, H - 50);
    ctx.lineTo(s.shipX + 18, H - 50);
    ctx.closePath();
    ctx.fill();
    // engine flame
    ctx.fillStyle = rgb(P.accent, 0.85);
    const fl = 10 + Math.sin(s.t * 40) * 5;
    ctx.beginPath();
    ctx.moveTo(s.shipX - 7, H - 50);
    ctx.lineTo(s.shipX, H - 50 + fl);
    ctx.lineTo(s.shipX + 7, H - 50);
    ctx.closePath();
    ctx.fill();
  }

  if (engine === "leap") {
    // parallax bg
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(P.bg));
    g.addColorStop(1, rgb(P.accent, 0.16));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // platforms
    ctx.shadowBlur = 10;
    ctx.shadowColor = rgb(P.platform, 0.8);
    ctx.fillStyle = rgb(P.platform);
    s.platforms.forEach((p: any) => {
      ctx.fillRect(p.x, p.y, p.w, 12);
      ctx.fillStyle = rgb(P.platform, 0.35);
      ctx.fillRect(p.x, p.y + 12, p.w, 4);
      ctx.fillStyle = rgb(P.platform);
    });
    // lava
    const lg = ctx.createLinearGradient(0, s.lavaY, 0, H);
    lg.addColorStop(0, rgb(P.accent, 0.95));
    lg.addColorStop(1, rgb(P.accent2 ?? P.accent, 1));
    ctx.shadowColor = rgb(P.accent);
    ctx.shadowBlur = 24;
    ctx.fillStyle = lg;
    ctx.fillRect(0, s.lavaY, W, H - s.lavaY + 10);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(0, s.lavaY, W, 3);
    // player
    ctx.shadowBlur = 18;
    ctx.shadowColor = rgb(P.ball);
    ctx.fillStyle = rgb(P.ball);
    ctx.beginPath();
    ctx.arc(s.px, s.py, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#10141c";
    ctx.fillRect(s.px - 5, s.py - 4, 3, 5);
    ctx.fillRect(s.px + 2, s.py - 4, 3, 5);
  }

  if (engine === "runner") {
    // bg city
    ctx.shadowBlur = 0;
    for (let i = 0; i < 16; i++) {
      const bw = 44 + ((i * 53) % 40);
      const bh = 60 + ((i * 97) % 130);
      ctx.fillStyle = rgb(P.platform, 0.16);
      ctx.fillRect((i * 52 - (s.dist * 0.24) % 52 + W) % (W + 52) - 26, H * 0.52 - bh, bw, bh);
    }
    // lanes
    const laneY = [H * 0.62, H * 0.74, H * 0.86];
    ctx.strokeStyle = rgb(P.accent, 0.2);
    ctx.lineWidth = 2;
    laneY.forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    });
    // ground stripes
    ctx.fillStyle = rgb(P.accent, 0.3);
    for (let i = 0; i < 10; i++) {
      const x = ((i * 96 - s.dist * 1.6) % (W + 96) + W + 96) % (W + 96) - 48;
      ctx.fillRect(x, H - 16, 52, 4);
    }
    // obstacles
    ctx.shadowBlur = 16;
    ctx.shadowColor = rgb(P.accent);
    s.obstacles.forEach((o: any) => {
      ctx.fillStyle = rgb(P.accent, 0.95);
      ctx.fillRect(o.x - 20, laneY[o.lane] - 44, 40, 44);
    });
    // player
    ctx.shadowColor = rgb(P.ball);
    ctx.fillStyle = rgb(P.ball);
    ctx.beginPath();
    ctx.arc(s.laneX, laneY[s.lane] - 22, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0a0e16";
    ctx.fillRect(s.laneX - 6, laneY[s.lane] - 27, 3.5, 6);
    ctx.fillRect(s.laneX + 3, laneY[s.lane] - 27, 3.5, 6);
    // speed lines
    ctx.strokeStyle = rgb(P.accent2, 0.28);
    for (let i = 0; i < 6; i++) {
      const y = ((i * 83 + s.t * 400) % H + H) % H;
      const x = W - ((s.t * 900 + i * 160) % (W * 0.7));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 46, y);
      ctx.stroke();
    }
  }

  ctx.restore();
}
