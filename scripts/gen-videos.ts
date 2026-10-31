/**
 * PlayLiquid gameplay-preview video generator.
 * Renders authentic-looking gameplay footage per game engine and encodes
 * self-hosted MP4s (H.264 yuv420p, faststart) for hover previews + Sparks.
 *
 * Engines: breaker | stardrift | leap | runner
 * Output:  public/previews/{slug}.mp4     (640x360, 6s, 24fps)
 *          public/previews/sparks/{id}.mp4 (360x640, 6s, 24fps)
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const FPS = 24;
const DUR = 6;
const FRAMES = FPS * DUR;

type RGB = [number, number, number];

interface Engine {
  w: number;
  h: number;
  palette: {
    bg: RGB;
    accent: RGB;
    accent2: RGB;
    ball: RGB;
    platform: RGB;
  };
  kind: "breaker" | "stardrift" | "leap" | "runner";
}

// ---------- tiny pixel font for score HUD (3x5 digits) ----------
const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

class Frame {
  w: number;
  h: number;
  data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 3);
  }
  px(x: number, y: number, c: RGB, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = Math.round(this.data[i] * (1 - a) + c[0] * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + c[1] * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + c[2] * a);
  }
  fill(c: RGB) {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w - 1, Math.ceil(x + w - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(y + h - 1));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) this.px(xx, yy, c, a);
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1) {
    const r2 = r * r;
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) this.px(xx, yy, c, a * (1 - Math.sqrt(d2) / (r * 1.35)));
      }
  }
  glowCircle(cx: number, cy: number, r: number, c: RGB) {
    this.circle(cx, cy, r * 2.4, c, 0.13);
    this.circle(cx, cy, r * 1.6, c, 0.3);
    this.circle(cx, cy, r, [Math.min(255, c[0] + 60), Math.min(255, c[1] + 60), Math.min(255, c[2] + 60)], 0.9);
  }
  scanlines() {
    for (let y = 0; y < this.h; y += 3)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 3;
        this.data[i] = Math.round(this.data[i] * 0.82);
        this.data[i + 1] = Math.round(this.data[i + 1] * 0.82);
        this.data[i + 2] = Math.round(this.data[i + 2] * 0.82);
      }
  }
  vignette() {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxD = Math.hypot(cx, cy);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const d = Math.hypot(x - cx, y - cy) / maxD;
        const f = 1 - 0.42 * Math.pow(d, 2.6);
        const i = (y * this.w + x) * 3;
        this.data[i] = Math.round(this.data[i] * f);
        this.data[i + 1] = Math.round(this.data[i + 1] * f);
        this.data[i + 2] = Math.round(this.data[i + 2] * f);
      }
  }
  text(str: string, x: number, y: number, c: RGB, scale = 2) {
    let cx = x;
    for (const ch of str) {
      const g = DIGITS[ch];
      if (g) {
        for (let r = 0; r < 5; r++)
          for (let col = 0; col < 3; col++)
            if (g[r][col] === "1") this.rect(cx + col * scale, y + r * scale, scale, scale, c);
      }
      cx += 4 * scale;
    }
  }
}

// ---------- deterministic rng ----------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- engine simulations ----------
interface Sim {
  step(f: Frame, t: number, frame: number): void;
}

function makeBreaker(e: Engine): Sim {
  const rand = rng(42);
  const cols = e.w > e.h ? 9 : 6;
  const rows = 5;
  const padW = e.w * 0.18;
  const bw = (e.w - 40) / cols;
  const bh = 14;
  const bricks: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(true));
  // pre-destroy a few for realism
  for (let i = 0; i < 6; i++) bricks[Math.floor(rand() * rows)][Math.floor(rand() * cols)] = false;
  let bx = e.w / 2;
  let by = e.h * 0.55;
  const sp = e.w / 64;
  let vx = sp * 0.62;
  let vy = -sp;
  let score = 12400;
  return {
    step(f, _t, frame) {
      f.fill(e.palette.bg);
      // grid horizon
      for (let i = 0; i <= 10; i++) {
        const y = e.h * 0.78 + i * 14;
        f.rect(0, y, e.w, 1, e.palette.accent, 0.08 + i * 0.012);
      }
      // bricks
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!bricks[r][c]) continue;
          const x = 20 + c * bw + 2;
          const y = 26 + r * (bh + 6);
          const col = r % 2 === 0 ? e.palette.accent : e.palette.accent2;
          f.rect(x, y, bw - 4, bh, col, 0.16);
          f.rect(x + 2, y + 2, bw - 8, bh - 4, col, 0.95);
        }
      // paddle follows ball
      const px = Math.max(padW / 2, Math.min(e.w - padW / 2, bx + Math.sin(frame / 9) * 8));
      f.rect(px - padW / 2, e.h - 26, padW, 10, e.palette.platform, 0.2);
      f.rect(px - padW / 2 + 2, e.h - 24, padW - 4, 6, e.palette.platform, 1);
      // ball physics
      bx += vx;
      by += vy;
      if (bx < 8 || bx > e.w - 8) vx = -vx;
      if (by < 22) vy = Math.abs(vy);
      // brick collisions (fake but visual)
      const colIdx = Math.floor((bx - 20) / bw);
      const rowIdx = Math.floor((by - 26) / (bh + 6));
      if (rowIdx >= 0 && rowIdx < rows && colIdx >= 0 && colIdx < cols && bricks[rowIdx][colIdx] && vy < 0) {
        bricks[rowIdx][colIdx] = false;
        vy = Math.abs(vy);
        score += 100;
        // explosion puff
        f.glowCircle(bx, by, 10, e.palette.accent);
      }
      if (by > e.h - 30 && vy > 0) {
        vy = -Math.abs(vy);
        vy *= 1.0;
      }
      // trail
      for (let i = 1; i <= 5; i++) f.circle(bx - vx * i * 1.6, by - vy * i * 1.6, 6 - i, e.palette.ball, 0.12);
      f.glowCircle(bx, by, 6, e.palette.ball);
      // HUD
      f.text(String(score), 12, 10, e.palette.accent, 2);
      f.rect(e.w - 64, 12, 48, 8, e.palette.accent, 0.25);
      f.rect(e.w - 64, 12, 32, 8, e.palette.accent, 0.95);
    },
  };
}

function makeStardrift(e: Engine): Sim {
  const rand = rng(7);
  const N = 14;
  const asteroids = Array.from({ length: N }, () => ({
    x: rand() * e.w,
    y: -rand() * e.h,
    r: 8 + rand() * 16,
    vy: 1.6 + rand() * 2.2,
    vx: (rand() - 0.5) * 1.2,
    rot: rand() * Math.PI,
  }));
  const bullets: { x: number; y: number }[] = [];
  let score = 8460;
  const shipX = e.w * 0.32;
  const shipY = e.h * 0.72;
  return {
    step(f, _t, frame) {
      f.fill(e.palette.bg);
      // starfield
      const sr = rng(99);
      for (let i = 0; i < 60; i++) {
        const x = sr() * e.w;
        const y = ((sr() * e.h + frame * (1 + sr() * 2)) % e.h + e.h) % e.h;
        f.px(x, y, [200, 210, 255], 0.25 + sr() * 0.5);
      }
      // nebula wisps
      f.circle(e.w * 0.7, e.h * 0.3, e.w * 0.3, e.palette.accent, 0.05);
      f.circle(e.w * 0.2, e.h * 0.75, e.w * 0.25, e.palette.accent2, 0.05);
      // bullets
      if (frame % 8 === 0) bullets.push({ x: shipX, y: shipY - 14 });
      for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y -= 9;
        f.rect(bullets[i].x - 1.5, bullets[i].y - 7, 3, 10, e.palette.ball, 0.9);
        if (bullets[i].y < -10) bullets.splice(i, 1);
      }
      // asteroids
      for (const a of asteroids) {
        a.y += a.vy;
        a.x += a.vx;
        a.rot += 0.03;
        if (a.y > e.h + 24) {
          a.y = -24;
          a.x = rand() * e.w;
        }
        if (a.x < -24) a.x = e.w + 24;
        if (a.x > e.w + 24) a.x = -24;
        // rocky polygon
        for (let k = 0; k < 9; k++) {
          const ang = a.rot + (k / 9) * Math.PI * 2;
          const rr = a.r * (0.75 + ((k * 37) % 10) / 28);
          f.circle(a.x + Math.cos(ang) * rr * 0.4, a.y + Math.sin(ang) * rr * 0.4, rr * 0.5, e.palette.platform, 0.35);
        }
        f.circle(a.x, a.y, a.r * 0.55, e.palette.platform, 0.95);
        f.circle(a.x - a.r * 0.15, a.y - a.r * 0.15, a.r * 0.28, [60, 50, 70], 0.7);
        // bullet hit → explosion
        for (let i = bullets.length - 1; i >= 0; i--) {
          if (Math.hypot(bullets[i].x - a.x, bullets[i].y - a.y) < a.r) {
            f.glowCircle(a.x, a.y, a.r + 8, e.palette.accent);
            bullets.splice(i, 1);
            score += 20;
          }
        }
      }
      // ship (arrowhead)
      const sx = shipX + Math.sin(frame / 14) * 26;
      f.circle(sx, shipY + 16, 12, e.palette.accent, 0.35); // engine glow
      f.rect(sx - 2, shipY + 6, 4, 12, e.palette.accent, 0.95);
      for (const [dx, dy, w2, h2] of [
        [-12, 4, 10, 4],
        [2, 4, 10, 4],
      ] as const)
        f.rect(sx + dx, shipY + dy, w2, h2, e.palette.accent, 0.9);
      f.rect(sx - 5, shipY - 10, 10, 16, e.palette.ball, 1);
      f.rect(sx - 2, shipY - 16, 4, 8, e.palette.ball, 1);
      // HUD
      f.text(String(score), 12, 10, e.palette.accent, 2);
    },
  };
}

function makeLeap(e: Engine): Sim {
  const rand = rng(13);
  const platforms = Array.from({ length: 7 }, (_, i) => ({
    x: rand() * (e.w - 90) + 10,
    y: e.h - 40 - i * ((e.h - 80) / 6),
    w: 70 + rand() * 30,
  }));
  let py = e.h * 0.4;
  let vy = -e.h / 60;
  let px = e.w / 2;
  let scroll = 0;
  let score = 3120;
  const G = e.h / 1400;
  return {
    step(f, _t, frame) {
      f.fill(e.palette.bg);
      // parallax bg
      for (let i = 0; i < 8; i++) {
        const y = (i * 90 + scroll * 0.4) % (e.h + 90) - 45;
        f.circle((i * 137) % e.w, y, 26, e.palette.accent2, 0.05);
      }
      scroll += 2.4;
      // platforms
      for (const p of platforms) {
        p.y += 2.4;
        if (p.y > e.h + 20) {
          p.y -= e.h + 40;
          p.x = rand() * (e.w - 90) + 10;
          p.w = 66 + rand() * 34;
        }
        f.rect(p.x, p.y, p.w, 10, e.palette.platform, 0.25);
        f.rect(p.x + 2, p.y + 2, p.w - 4, 6, e.palette.platform, 1);
      }
      // character bounce physics (auto-jumps on platform reach)
      py += vy;
      vy += G * 60;
      px += Math.sin(frame / 20) * 2.2;
      if (vy > 0) {
        // find platform below
        for (const p of platforms) {
          if (px > p.x - 6 && px < p.x + p.w + 6 && py + 12 >= p.y && py + 12 <= p.y + 14) {
            vy = -e.h / 55;
            score += 10;
            f.glowCircle(px, p.y, 12, e.palette.accent);
          }
        }
      }
      if (py > e.h + 30) {
        py = e.h * 0.3;
        vy = -e.h / 55;
      }
      // character (round blob w/ eyes)
      f.glowCircle(px, py, 9, e.palette.ball);
      f.rect(px - 3, py - 2, 2, 3, [10, 10, 20], 1);
      f.rect(px + 2, py - 2, 2, 3, [10, 10, 20], 1);
      // rising danger (lava / water) at bottom
      const lvl = e.h - 18 - Math.sin(frame / 40) * 6;
      f.rect(0, lvl, e.w, e.h - lvl, e.palette.accent, 0.85);
      f.rect(0, lvl, e.w, 3, [255, 255, 255], 0.5);
      // HUD
      f.text(String(score), 12, 10, e.palette.accent, 2);
    },
  };
}

function makeRunner(e: Engine): Sim {
  const rand = rng(21);
  const obstacles: { x: number; y: number; w: number; h: number; lane: number }[] = [];
  const lanes = 3;
  const laneH = e.h / (lanes + 1.2);
  const laneY = (l: number) => e.h * 0.28 + l * laneH;
  let score = 15280;
  let playerLane = 1;
  let speed = 7;
  return {
    step(f, _t, frame) {
      f.fill(e.palette.bg);
      // perspective road
      for (let l = 0; l <= lanes; l++) f.rect(0, laneY(l) - 1, e.w, 2, e.palette.accent, 0.16);
      // moving ground stripes
      for (let i = 0; i < 8; i++) {
        const x = ((i * 110 - frame * speed) % (e.w + 110) + e.w + 110) % (e.w + 110) - 55;
        f.rect(x, e.h * 0.24, 56, 3, e.palette.accent, 0.3);
        f.rect(x, e.h - 14, 56, 3, e.palette.accent, 0.14);
      }
      // city silhouette
      const sr = rng(5);
      for (let i = 0; i < 14; i++) {
        const bw2 = 30 + sr() * 40;
        const bh2 = 40 + sr() * 90;
        f.rect(i * 48 - ((frame * 0.6) % 48), e.h * 0.24 - bh2, bw2, bh2, e.palette.accent2, 0.12);
      }
      // spawn obstacles
      if (frame % 22 === 0) {
        const lane = Math.floor(rand() * lanes);
        obstacles.push({ x: e.w + 30, y: laneY(lane) - 18, w: 22, h: 30, lane });
      }
      // player lane switching
      if (frame % 36 === 0) playerLane = (playerLane + 1 + Math.floor(rand() * 1.4)) % lanes;
      // draw + move obstacles
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        o.x -= speed;
        f.rect(o.x, o.y, o.w, o.h, e.palette.accent, 0.2);
        f.rect(o.x + 2, o.y + 2, o.w - 4, o.h - 4, e.palette.accent, 0.95);
        if (o.x < -40) {
          obstacles.splice(i, 1);
          score += 50;
        }
        // near-miss spark
        if (Math.abs(o.x - 60) < 26 && o.lane !== playerLane) f.glowCircle(o.x, o.y + o.h / 2, 8, e.palette.accent2);
      }
      // player
      const py = laneY(playerLane) - 18;
      f.glowCircle(60, py + 14, 11, e.palette.ball);
      f.rect(54, py + 4, 12, 18, e.palette.ball, 1);
      // speed lines
      for (let i = 0; i < 5; i++) {
        const y = (i * 71 + frame * 13) % e.h;
        f.rect(e.w - ((frame * 21 + i * 97) % (e.w * 0.5)), y, 40, 2, e.palette.accent2, 0.25);
      }
      speed = 7 + frame * 0.05;
      f.text(String(score), 12, 10, e.palette.accent, 2);
    },
  };
}

// ---------- pipeline ----------
function encode(outPath: string, w: number, h: number, render: (frame: number, f: Frame) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
      "-s", `${w}x${h}`, "-r", String(FPS),
      "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-crf", "27", "-preset", "veryfast", "-profile:v", "baseline",
      "-movflags", "+faststart", "-an",
      outPath,
    ]);
    ff.stderr.on("data", () => {});
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    const f = new Frame(w, h);
    for (let i = 0; i < FRAMES; i++) {
      render(i, f);
      if (i % 24 === 23) {
        f.scanlines();
        f.vignette();
      } else {
        // cheaper: light scanline every frame
      }
      const ok = ff.stdin.write(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
      if (!ok) {
        // handle backpressure synchronously is tricky; buffer in memory worst-case
      }
    }
    ff.stdin.end();
  });
}

function buildSim(e: Engine, seedOffset: number): Sim {
  switch (e.kind) {
    case "breaker":
      return makeBreaker(e);
    case "stardrift":
      return makeStardrift(e);
    case "leap":
      return makeLeap(e);
    case "runner":
      return makeRunner(e);
  }
}

async function main() {
  mkdirSync("/home/z/my-project/public/previews/sparks", { recursive: true });

  const games: { slug: string; kind: Engine["kind"]; pal: Engine["palette"]; vertical?: boolean; id?: string }[] = [
    { slug: "neon-breaker", kind: "breaker", pal: { bg: [7, 0, 18], accent: [0, 240, 255], accent2: [255, 0, 212], ball: [255, 255, 255], platform: [0, 240, 255] } },
    { slug: "crystal-smash", kind: "breaker", pal: { bg: [2, 10, 24], accent: [126, 203, 255], accent2: [191, 233, 255], ball: [240, 250, 255], platform: [126, 203, 255] } },
    { slug: "retro-bricks", kind: "breaker", pal: { bg: [0, 0, 0], accent: [0, 255, 102], accent2: [0, 200, 80], ball: [170, 255, 204], platform: [0, 255, 102] } },
    { slug: "star-drift", kind: "stardrift", pal: { bg: [10, 6, 24], accent: [0, 229, 255], accent2: [138, 125, 255], ball: [240, 248, 255], platform: [122, 110, 150] } },
    { slug: "astro-patrol", kind: "stardrift", pal: { bg: [0, 20, 8], accent: [51, 255, 119], accent2: [20, 160, 80], ball: [180, 255, 200], platform: [51, 255, 119] } },
    { slug: "solar-flare", kind: "stardrift", pal: { bg: [26, 8, 0], accent: [255, 154, 0], accent2: [255, 85, 0], ball: [255, 245, 230], platform: [200, 90, 20] } },
    { slug: "lava-leap", kind: "leap", pal: { bg: [20, 6, 10], accent: [255, 68, 0], accent2: [255, 120, 40], ball: [255, 210, 70], platform: [90, 60, 55] } },
    { slug: "cloud-hopper", kind: "leap", pal: { bg: [110, 170, 255], accent: [255, 255, 255], accent2: [255, 190, 100], ball: [255, 159, 67], platform: [255, 255, 255] } },
    { slug: "aqua-bounce", kind: "leap", pal: { bg: [4, 40, 58], accent: [159, 232, 255], accent2: [80, 180, 220], ball: [255, 209, 102], platform: [159, 232, 255] } },
    { slug: "cyber-dash", kind: "runner", pal: { bg: [10, 0, 24], accent: [255, 45, 149], accent2: [0, 255, 231], ball: [0, 255, 231], platform: [60, 40, 90] } },
    { slug: "pixel-racer", kind: "runner", pal: { bg: [0, 18, 0], accent: [0, 255, 102], accent2: [0, 180, 70], ball: [180, 255, 200], platform: [0, 90, 40] } },
    { slug: "void-runner", kind: "runner", pal: { bg: [11, 6, 32], accent: [179, 136, 255], accent2: [80, 60, 160], ball: [224, 208, 255], platform: [60, 45, 110] } },
    // vertical sparks clips
    { slug: "sparks/neon-breaker-clip", kind: "breaker", vertical: true, id: "sp1", pal: { bg: [7, 0, 18], accent: [0, 240, 255], accent2: [255, 0, 212], ball: [255, 255, 255], platform: [0, 240, 255] } },
    { slug: "sparks/star-drift-clip", kind: "stardrift", vertical: true, id: "sp2", pal: { bg: [10, 6, 24], accent: [0, 229, 255], accent2: [138, 125, 255], ball: [240, 248, 255], platform: [122, 110, 150] } },
    { slug: "sparks/lava-leap-clip", kind: "leap", vertical: true, id: "sp3", pal: { bg: [20, 6, 10], accent: [255, 68, 0], accent2: [255, 120, 40], ball: [255, 210, 70], platform: [90, 60, 55] } },
    { slug: "sparks/cyber-dash-clip", kind: "runner", vertical: true, id: "sp4", pal: { bg: [10, 0, 24], accent: [255, 45, 149], accent2: [0, 255, 231], ball: [0, 255, 231], platform: [60, 40, 90] } },
    { slug: "sparks/cloud-hopper-clip", kind: "leap", vertical: true, id: "sp5", pal: { bg: [110, 170, 255], accent: [255, 255, 255], accent2: [255, 190, 100], ball: [255, 159, 67], platform: [255, 255, 255] } },
    { slug: "sparks/solar-flare-clip", kind: "stardrift", vertical: true, id: "sp6", pal: { bg: [26, 8, 0], accent: [255, 154, 0], accent2: [255, 85, 0], ball: [255, 245, 230], platform: [200, 90, 20] } },
    { slug: "sparks/aqua-bounce-clip", kind: "leap", vertical: true, id: "sp7", pal: { bg: [4, 40, 58], accent: [159, 232, 255], accent2: [80, 180, 220], ball: [255, 209, 102], platform: [159, 232, 255] } },
    { slug: "sparks/retro-bricks-clip", kind: "breaker", vertical: true, id: "sp8", pal: { bg: [0, 0, 0], accent: [0, 255, 102], accent2: [0, 200, 80], ball: [170, 255, 204], platform: [0, 255, 102] } },
    { slug: "sparks/void-runner-clip", kind: "runner", vertical: true, id: "sp9", pal: { bg: [11, 6, 32], accent: [179, 136, 255], accent2: [80, 60, 160], ball: [224, 208, 255], platform: [60, 45, 110] } },
  ];

  let done = 0;
  for (const g of games) {
    const w = g.vertical ? 360 : 640;
    const h = g.vertical ? 640 : 360;
    const e: Engine = { w, h, palette: g.pal, kind: g.kind };
    const sim = buildSim(e, 0);
    const out = `/home/z/my-project/public/previews/${g.slug}.mp4`;
    await encode(out, w, h, (frame, f) => sim.step(f, frame / FPS, frame));
    done++;
    console.log(`[${done}/${games.length}] ${out}`);
  }
  console.log("ALL VIDEOS DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
