# Flap Emonad - Complete Technical Documentation

## Overview
Flap Emonad is a Flappy Bird-style game built with HTML5 Canvas and vanilla JavaScript, featuring on-chain leaderboard integration on the Monad blockchain. The game includes custom sprite animations, physics-based gameplay, a full chiptune audio system, and is optimized for both desktop and mobile devices.

**Key Features:**
- Flappy Bird gameplay mechanics with custom emo-themed sprites
- On-chain score submission via smart contract on Monad
- Server-side anti-cheat validation with cryptographic signatures
- Full chiptune audio system (Web Audio API) with 6 unique tracks
- Loading screen with animations
- Responsive design for all devices

---

## File Structure

```
flapemonad/
├── index.html              # Main game page with loading screen
├── leaderboard.html        # Leaderboard page (displays on-chain scores)
├── style.css               # Styling and responsive layout
├── script.js               # Game logic, wallet integration (~1200 lines)
├── audio.js                # Chiptune music & SFX system (~1100 lines)
├── flap1.PNG               # Flying animation frame 1
├── flap2.PNG               # Flying animation frame 2
├── flap3.PNG               # Flying animation frame 3
├── die1.PNG                # Death animation frame 1
├── die2.PNG                # Death animation frame 2
├── die3.PNG                # Death animation frame 3
├── razor.PNG               # Obstacle sprite
├── GAME_DOCUMENTATION.md   # This file
└── server/
    ├── referee.js          # Anti-cheat server (Node.js)
    ├── package.json        # Server dependencies
    └── start-server.bat    # Server startup script (contains private key)
```

---

## Smart Contract & Blockchain Integration

### Network Configuration
```javascript
MONAD_CHAIN_ID = 143
MONAD_RPC = 'https://rpc.monad.xyz'
```

### Leaderboard Contract
**Address:** `0x7fffA7d3FF68A8781d3cc724810ddb03601D9642`

**Contract ABI (Key Functions):**
```solidity
// Submit a score with referee signature
function submitScore(string name, uint256 score, bytes signature) external

// Get top N scores
function getTopScores(uint256 count) external view returns (tuple[])

// Get a player's best score
function getPlayerBestScore(address player) external view returns (uint256)

// Check if address has submitted a score
function hasSubmitted(address player) external view returns (bool)
```

### Score Submission Flow
1. Player completes a game and enters their name
2. Client sends game data to referee server for validation
3. Referee server validates:
   - Game duration matches score (anti-speed-hack)
   - Score is within reasonable bounds
   - Request hasn't been replayed
4. Referee signs the score with its private key
5. Client submits score + signature to smart contract
6. Contract verifies signature matches authorized referee
7. Score is stored on-chain

### Anti-Cheat System
The referee server (`server/referee.js`) implements:
- **Duration validation:** Score must match reasonable play time
- **Replay protection:** Each signature is unique per submission
- **Rate limiting:** Prevents spam submissions
- **Signature verification:** Only referee-signed scores are accepted by contract

**Referee Server URL:** Configured via Cloudflare tunnel (changes per session)

---

## Audio System (audio.js)

### ChiptunePlayer Class
The audio system uses Web Audio API to generate all music and sound effects programmatically (no audio files).

### Music Tracks
| Track | Name | Key | Tempo | Use |
|-------|------|-----|-------|-----|
| `trackMenu()` | "Pixel Hearts" | E minor | 95 BPM | Home screen (8 sections, ~80 seconds) |
| `track1()` | "Melancholy Pixels" | E minor | 78 BPM | Gameplay random |
| `track2()` | "Digital Tears" | A minor | 92 BPM | Gameplay random |
| `track3()` | "Broken Circuits" | D minor | 138 BPM | Gameplay random |
| `trackGameOver()` | "Farewell" | A minor | 58 BPM | Death screen (6 sections) |
| `trackLeaderboard()` | "Hall of Champions" | D major | 108 BPM | Leaderboard page (6 sections) |

### Sound Effects
| Method | Description |
|--------|-------------|
| `playFlap()` | Wing flap - filtered noise + tonal flick |
| `playScore()` | Score point - low bassy thump (120-180 Hz) |
| `playDeath()` | Death - impact + descending arpeggio + rumble |
| `playHighScore()` | New high score - ascending celebratory arpeggio |
| `playClick()` | UI button - two-tone blip |

### Audio Integration Points
```javascript
// In script.js:
flap()           → chiptunePlayer.playFlap()
die()            → chiptunePlayer.stop() + chiptunePlayer.playDeath()
showGameOver()   → chiptunePlayer.playGameOverMusic() (after 600ms)
startGame()      → chiptunePlayer.playTrack(random 1-3)
score increment  → chiptunePlayer.playScore()
```

### Mute/Unmute
```javascript
chiptunePlayer.toggleMute()  // Returns new mute state
chiptunePlayer.isMuted       // Current mute state
```

---

## Game States

The game uses a state machine with 4 states:

| State | Description |
|-------|-------------|
| `READY` | Start screen with animated characters, waiting for input |
| `PLAYING` | Active gameplay - player can flap, obstacles spawn |
| `DYING` | Death animation playing, player falling to ground |
| `GAME_OVER` | Game over screen displayed, waiting for restart |

---

## Core Constants

### Canvas Resolution
```javascript
GAME_WIDTH = 1080      // Internal canvas width
GAME_HEIGHT = 1620     // Internal canvas height (2:3 aspect ratio)
```

### Physics (tuned for 60fps baseline)
```javascript
TARGET_FPS = 60                    // Base frame rate for physics
GRAVITY = 1.2                      // Downward acceleration per frame
JUMP_VELOCITY = -24                // Upward velocity on flap (negative = up)
MAX_FALL_SPEED = 34                // Terminal velocity cap
ROTATION_SPEED = 4                 // Degrees per frame when falling
JUMP_ROTATION = -25                // Instant rotation on flap (nose up)
MAX_ROTATION = 90                  // Maximum nose-dive angle
```

### Player Settings
```javascript
PLAYER_WIDTH = 270                 // Sprite display width
PLAYER_HEIGHT = 270                // Sprite display height
PLAYER_X = 270                     // Fixed horizontal position
HITBOX_PADDING = 40                // Pixels to shrink hitbox (fairness)
```

### Animation Timing
```javascript
FLAP_ANIMATION_SPEED = 100         // ms between flying frames
DEATH_ANIMATION_SPEED = 300        // ms between death frames
```

### Obstacle (Razor) Settings
```javascript
RAZOR_WIDTH = 170                  // Obstacle width
RAZOR_GAP = 470                    // Vertical gap between top/bottom razors
RAZOR_SPEED = 8.5                  // Horizontal movement per frame
RAZOR_SPAWN_INTERVAL = 1800        // ms between new obstacle spawns
MIN_RAZOR_Y = 270                  // Minimum gap position from top
MAX_RAZOR_Y = GAME_HEIGHT - RAZOR_GAP - 270  // Maximum gap position
```

---

## Key Systems

### 1. Delta Time Normalization
The game runs consistently across all monitor refresh rates (60Hz, 144Hz, 240Hz) by scaling physics calculations:

```javascript
const timeScale = deltaTime / TARGET_FRAME_TIME;
player.velocity += GRAVITY * timeScale;
player.y += player.velocity * timeScale;
razor.x -= RAZOR_SPEED * timeScale;
```

### 2. Animation System

**Flying Animation:**
- Loops through `flap1.PNG → flap2.PNG → flap3.PNG`
- Frame changes every 100ms
- Runs continuously during `PLAYING` state

**Death Animation:**
- Plays `die1.PNG → die2.PNG → die3.PNG` once
- Frame changes every 300ms (slower for visibility)
- Stays on `die3.PNG` after completion

### 3. Collision Detection

Hitboxes are shrunk by `HITBOX_PADDING` for fairness:

```javascript
// Player hitbox (shrunk)
playerLeft = player.x + HITBOX_PADDING
playerRight = player.x + PLAYER_WIDTH - HITBOX_PADDING
playerTop = player.y + HITBOX_PADDING
playerBottom = player.y + PLAYER_HEIGHT - HITBOX_PADDING

// Razor hitbox (slightly padded)
razorLeft = razor.x + 17
razorRight = razor.x + RAZOR_WIDTH - 17
```

Collision triggers on:
- Hitting top or bottom razor
- Hitting the floor (bottom of screen)

### 4. Obstacle Rendering

Each obstacle consists of:
1. **Top razor** - Rotated 180° (blade pointing down)
2. **Red bar** - Extends from screen top to razor (`#EF5350`)
3. **Bottom razor** - Normal orientation (blade pointing up)
4. **Green bar** - Extends from razor to screen bottom (`#26A69A`)

The red/green colors represent trading chart candles (bearish/bullish).

### 5. Scoring
- +1 point when player passes an obstacle pair
- Score displayed at top center in Creepster font (emo style)
- Final score shown on game over screen

---

## Input Handling

| Input | Action |
|-------|--------|
| Spacebar | Start game / Flap / Restart |
| Left Click | Start game / Flap |
| Touch (mobile) | Start game / Flap |
| Restart Button | Restart game |

All inputs route through `handleInput()` which checks current state:
```javascript
function handleInput() {
    if (gameState === GameState.READY) startGame();
    else if (gameState === GameState.PLAYING) flap();
    else if (gameState === GameState.GAME_OVER) resetGame();
}
```

---

## Start Screen

The start screen is rendered on canvas (not HTML) with:
- **Title**: "FLAP EMONAD" in Creepster font
- **Top character**: Flying animation loop with bobbing motion
- **Middle text**: "Click or Press Space to Start" with pulsing opacity
- **Bottom character**: Death animation loop with wobble effect

---

## Styling

### Font
- **Creepster** (Google Fonts) - Gothic/emo style
- Used for: Title, score, game over text, restart button

### Colors
- **Background**: Pure white (`#FFFFFF`)
- **Top bars**: Red (`#EF5350`) - bearish candle
- **Bottom bars**: Green (`#26A69A`) - bullish candle
- **Text**: Black (`#000000`)

### Responsive Design
- Maintains 2:3 aspect ratio
- Fills viewport height on mobile
- Centered on desktop with shadow

---

## Mobile Optimizations

```css
touch-action: manipulation;        /* Prevents zoom on double-tap */
-webkit-touch-callout: none;       /* Prevents iOS callout */
user-select: none;                 /* Prevents text selection */
```

Touch events use `{ passive: false }` to allow `preventDefault()`.

---

## Game Loop

```javascript
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    update(deltaTime);    // Physics, collisions, spawning
    render(deltaTime);    // Draw everything
    
    requestAnimationFrame(gameLoop);
}
```

---

## Screen Flow

```
┌─────────────────┐
│   START SCREEN  │
│    (READY)      │
│                 │
│  "FLAP EMONAD"  │
│   [Flying Emo]  │
│  "Click to Start"│
│   [Dying Emo]   │
└────────┬────────┘
         │ Click/Space/Touch
         ▼
┌─────────────────┐
│   GAMEPLAY      │
│   (PLAYING)     │
│                 │
│  Score: X       │
│  [Player flaps] │
│  [Razors move]  │
└────────┬────────┘
         │ Collision
         ▼
┌─────────────────┐
│   DEATH         │
│   (DYING)       │
│                 │
│  [Death anim]   │
│  [Falls down]   │
└────────┬────────┘
         │ Hits floor
         ▼
┌─────────────────┐
│   GAME OVER     │
│   (GAME_OVER)   │
│                 │
│  "GAME OVER"    │
│  Score: X       │
│  [RESTART]      │
└────────┬────────┘
         │ Click/Space/Button
         ▼
      (Back to READY)
```

---

## Player Object

```javascript
const player = {
    x: PLAYER_X,              // Fixed at 270px from left
    y: PLAYER_START_Y,        // Starts vertically centered
    velocity: 0,              // Current vertical speed
    rotation: 0,              // Current angle in degrees
    
    currentFrame: 0,          // 0, 1, or 2 for flap animation
    animationTimer: 0,        // Tracks time between frames
    isFlapping: true,         // Always true during PLAYING
    
    deathFrame: 0,            // 0, 1, or 2 for death animation
    deathAnimationTimer: 0,   // Tracks death frame timing
    deathAnimationComplete: false
};
```

---

## Razor Object

Each razor in the `razors[]` array:
```javascript
{
    x: GAME_WIDTH,            // Starts at right edge
    gapY: randomValue,        // Y position of gap top
    scored: false             // Becomes true when player passes
}
```

---

## Function Reference

### Game Control
| Function | Purpose |
|----------|---------|
| `init()` | Loads images, starts game loop |
| `startGame()` | Transitions READY → PLAYING |
| `flap()` | Sets jump velocity and rotation |
| `die()` | Transitions PLAYING → DYING |
| `showGameOver()` | Transitions DYING → GAME_OVER |
| `resetGame()` | Resets all state, goes to READY |

### Update Functions
| Function | Purpose |
|----------|---------|
| `update(deltaTime)` | Main update dispatcher |
| `updatePlayer(deltaTime)` | Physics, position, animation |
| `updateRazors(deltaTime)` | Movement, spawning, scoring |

### Render Functions
| Function | Purpose |
|----------|---------|
| `render(deltaTime)` | Main render dispatcher |
| `drawStartScreen(deltaTime)` | Animated start screen |
| `drawPlayer()` | Player sprite with rotation |
| `drawRazors()` | Obstacles with colored bars |
| `drawScore()` | Score text at top |

### Utility Functions
| Function | Purpose |
|----------|---------|
| `loadImage(src)` | Promise-based image loader |
| `loadAllImages()` | Loads all 7 sprites |
| `handleInput()` | Routes input to correct action |
| `spawnRazor()` | Creates new razor at random Y |
| `checkCollisions()` | Returns true if player hit something |

---

## Physics Mechanics

### Gravity
Every frame, velocity increases by `GRAVITY * timeScale`:
```
velocity = velocity + 1.2
```
Capped at `MAX_FALL_SPEED` (34).

### Flap
On input, velocity is SET (not added) to `JUMP_VELOCITY`:
```
velocity = -24  (instant upward boost)
rotation = -25  (nose points up)
```

### Rotation
While falling (`velocity > 0`), rotation increases toward nose-dive:
```
rotation = rotation + 4  (per frame, scaled)
```
Capped at `MAX_ROTATION` (90°).

### Position
Every frame:
```
y = y + velocity
```

---

## Collision Zones

```
        ┌─────────┐
        │ RED BAR │  ← Collision if playerTop < gapY
        ├─────────┤
        │  RAZOR  │  ← Top razor (rotated 180°)
        └─────────┘
             ↑
           gapY
        ┌─────────┐
        │   GAP   │  ← Safe zone (470px tall)
        │         │
        └─────────┘
             ↓
        gapY + RAZOR_GAP
        ┌─────────┐
        │  RAZOR  │  ← Bottom razor
        ├─────────┤
        │GREEN BAR│  ← Collision if playerBottom > gapY + GAP
        └─────────┘
```

Floor collision: `playerBottom >= GAME_HEIGHT`

---

## Code Organization (script.js)

| Section | Description |
|---------|-------------|
| Constants | Canvas setup, physics values, player/razor settings |
| Game State | State machine (READY, PLAYING, DYING, GAME_OVER) |
| Player Object | Position, velocity, rotation, animation state |
| Image Loading | Promise-based sprite loading |
| Input Handling | Keyboard, mouse, touch events |
| Game Functions | startGame, flap, die, showGameOver, resetGame |
| Razor Management | Spawning, movement, scoring |
| Collision Detection | Hitbox calculations, boundary checks |
| Update Functions | Physics, animations, state transitions |
| Render Functions | Canvas drawing for all game elements |
| Loading Screen | Progress bar, play button, music start |
| Wallet Functions | MetaMask connection, network switching |
| Score Submission | Referee validation, contract interaction |
| Game Loop | requestAnimationFrame-based main loop |

---

## Loading Screen System

The game features a loading screen that:
1. Shows animated title and bird
2. Displays loading progress bar
3. Shows "PLAY" button when ready
4. Clicking PLAY dismisses loading screen AND starts music

```javascript
// Loading flow:
init() → updateLoadingBar(progress) → showPlayButton() → startGameFromLoading() → dismissLoadingScreen()
```

This solves the browser autoplay restriction - music starts on the PLAY button click.

---

## Wallet Integration

### Supported Wallets
- MetaMask (primary)
- Any EIP-1193 compatible wallet

### Connection Flow
```javascript
connectWallet() → window.ethereum.request({ method: 'eth_requestAccounts' })
                → switchToMonadNetwork() (if needed)
                → updateWalletUI()
```

### Network Auto-Switch
If user is on wrong network, the game automatically prompts to add/switch to Monad:
```javascript
await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [{
        chainId: '0x8F',  // 143 in hex
        chainName: 'Monad Testnet',
        rpcUrls: ['https://rpc.monad.xyz'],
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
    }]
});
```

---

## Leaderboard Page (leaderboard.html)

### Features
- Displays top 100 scores from blockchain
- Shows player rank, name, score, wallet address
- Highlights current user's scores
- Connect wallet to see personal ranking
- Sound toggle button
- Plays "Hall of Champions" music

### Data Fetching
```javascript
const scores = await contract.getTopScores(100);
// Returns array of { player, name, score, timestamp }
```

---

## Server Setup (for development)

### Prerequisites
- Node.js installed
- npm packages: express, ethers, cors

### Starting the Referee Server
```bash
cd server
npm install
node referee.js
```

Or use Cloudflare tunnel for HTTPS:
```bash
cloudflared tunnel --url http://localhost:3000
```

Update `REFEREE_SERVER_URL` in script.js with the tunnel URL.

---

## Deployment Checklist

1. ✅ Deploy smart contract to Monad
2. ✅ Update `LEADERBOARD_ADDRESS` in script.js and leaderboard.html
3. ✅ Start referee server with correct private key
4. ✅ Update `REFEREE_SERVER_URL` with server/tunnel URL
5. ✅ Test score submission flow end-to-end
6. ✅ Verify leaderboard displays scores correctly

---

## Troubleshooting

### Music not playing
- Browser requires user interaction before audio
- Click the PLAY button on loading screen
- Check if muted (🔇 icon)

### Score submission fails
- Ensure wallet is connected to Monad network
- Check referee server is running
- Verify game duration matches score (anti-cheat)

### Wallet not connecting
- Must use HTTPS (or localhost)
- MetaMask must be installed
- Check browser console for errors

---

*Last Updated: January 2026*
