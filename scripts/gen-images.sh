#!/bin/bash
mkdir -p /home/z/my-project/public/covers /home/z/my-project/public/avatars
cd /home/z/my-project
STYLE="vibrant retro arcade video game cover art, neon glow, dark atmospheric background, cinematic lighting, highly detailed digital illustration, no text, no words, no letters"

gen() {
  local file="$1"; local prompt="$2"; local size="${3:-1344x768}"
  if [ -s "/home/z/my-project/public/$file" ]; then echo "skip $file"; return; fi
  for attempt in 1 2 3; do
    z-ai image -p "$prompt, $STYLE" -o "/home/z/my-project/public/$file" -s "$size" >/dev/null 2>&1
    if [ -s "/home/z/my-project/public/$file" ]; then echo "OK $file"; return; fi
    sleep $((attempt * 4))
  done
  echo "FAIL $file"
}

gen covers/neon-breaker.jpg "neon brick-breaker arcade game key art, glowing cyan and magenta energy bricks, plasma ball with motion trail, futuristic grid horizon"
gen covers/cyber-dash.jpg "cyberpunk endless runner game key art, sprinting courier across neon city rooftops at night, holographic obstacles, pink and teal speed lines"
gen covers/crystal-smash.jpg "crystal puzzle arcade game key art, exploding geode of blue and white crystals, icy cavern, glowing shards frozen mid-shatter"
gen covers/astro-patrol.jpg "retro radar space defense game key art, green phosphor CRT aesthetic, triangular starfighters intercepting UFO fleet, scanline circles"
gen covers/cloud-hopper.jpg "cheerful sky platformer game key art, fluffy white cloud platforms in bright blue sky, happy round character mid-bounce, rainbow trail"
gen covers/pixel-racer.jpg "retro 8-bit racing game key art, pixel art sports cars racing on night highway, green monochrome CRT scanlines, motion streaks"
gen covers/void-runner.jpg "dark void endless runner game key art, glowing silhouette dashing through violet cosmic void, floating geometric obstacles, star particles"
gen covers/aqua-bounce.jpg "underwater arcade game key art, joyful diver character bouncing on giant bubbles in deep aqua ocean, god rays, tropical fish"
gen covers/retro-bricks.jpg "classic vintage arcade game key art, minimal green phosphor monochrome brick wall on black CRT screen, 1970s minimalist perfection"
gen covers/solar-flare.jpg "solar space shooter game key art, white-hot fighter ship dodging towering solar flares and fiery asteroids near the sun, orange corona"
gen covers/chrono-realms.jpg "epic fantasy RPG game key art, armored hero with glowing hourglass shield before a colossal stone clocktower portal, golden time energy"
gen covers/mystic-grove.jpg "cozy fantasy adventure game key art, tiny wizard fox in bioluminescent mushroom forest at night, teal and violet fireflies"
gen covers/quantum-chess.jpg "futuristic strategy game key art, holographic chess pieces made of light on a quantum board splitting into parallel realities"
gen avatars/playliquid-labs.jpg "game studio logo avatar, liquid chrome game controller melting into droplet, cyan and violet gradient, glossy 3D render" 1024x1024
gen avatars/neon-forge.jpg "game studio logo avatar, blacksmith anvil striking neon sparks, dark background, bold icon style" 1024x1024
gen avatars/pixel-pioneers.jpg "game studio logo avatar, retro pixel art explorer character with pickaxe, 8-bit style, warm colors" 1024x1024
gen avatars/starloop.jpg "game studio logo avatar, elegant orbit loop around a glowing star, deep space blues, minimal icon" 1024x1024
gen avatars/volcano-interactive.jpg "game studio logo avatar, cute cartoon volcano character with sunglasses and controller, playful style" 1024x1024
gen avatars/cloud-nine.jpg "game studio logo avatar, smiling white cloud holding a joystick, soft sky blue, friendly flat style" 1024x1024
echo "ALL DONE"
