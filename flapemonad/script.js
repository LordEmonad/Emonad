// ============================================
// FLAP EMONAD - A Flappy Bird Clone
// ============================================

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Enable HIGH QUALITY image smoothing for best rendering
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

// Set canvas resolution (internal) - Maximum res for crisp rendering
const GAME_WIDTH = 1080;
const GAME_HEIGHT = 1620;
canvas.width = GAME_WIDTH;
canvas.height = GAME_HEIGHT;

// UI Elements
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart-btn');

// ============================================
// GAME CONSTANTS - Tuned for authentic feel
// ============================================

// Physics (tuned to feel like original Flappy Bird, scaled for high res)
const GRAVITY = 1.2;               // Gravity acceleration per frame
const JUMP_VELOCITY = -24;         // Velocity set on flap (not added)
const MAX_FALL_SPEED = 34;         // Terminal velocity
const ROTATION_SPEED = 4;          // Degrees per frame when falling
const JUMP_ROTATION = -25;         // Rotation on flap (degrees)
const MAX_ROTATION = 90;           // Max nose-dive rotation

// Player settings (scaled for high resolution - large crisp sprites)
const PLAYER_WIDTH = 270;          // Display width (larger for detail)
const PLAYER_HEIGHT = 270;         // Display height (larger for detail)
const PLAYER_X = 270;              // Fixed X position
const PLAYER_START_Y = GAME_HEIGHT / 2 - PLAYER_HEIGHT / 2;
const HITBOX_PADDING = 40;         // Shrink hitbox for fairness

// Animation timing
const FLAP_ANIMATION_SPEED = 100;  // ms between flap frames
const DEATH_ANIMATION_SPEED = 300; // ms between death frames (slower for visibility)

// Razor (obstacle) settings (scaled for high resolution)
const RAZOR_WIDTH = 170;           // Display width
const RAZOR_HEIGHT = 680;          // Display height (will tile if needed)
const RAZOR_GAP = 470;             // Gap between top and bottom razors
const RAZOR_SPEED = 8.5;           // Pixels per frame
const RAZOR_SPAWN_INTERVAL = 1800; // ms between razor spawns
const MIN_RAZOR_Y = 270;           // Minimum gap position from top
const MAX_RAZOR_Y = GAME_HEIGHT - RAZOR_GAP - 270; // Maximum gap position

// ============================================
// GAME STATE
// ============================================

const GameState = {
    READY: 'ready',
    PLAYING: 'playing',
    DYING: 'dying',
    GAME_OVER: 'game_over'
};

let gameState = GameState.READY;
let score = 0;
let lastTime = 0;
let razorSpawnTimer = 0;

// Start screen animation state
let startScreenFlapFrame = 0;
let startScreenDieFrame = 0;
let startScreenAnimTimer = 0;

// ============================================
// PLAYER OBJECT
// ============================================

const player = {
    x: PLAYER_X,
    y: PLAYER_START_Y,
    velocity: 0,
    rotation: 0,
    
    // Animation state
    currentFrame: 0,
    animationTimer: 0,
    isFlapping: true,
    
    // Death animation
    deathFrame: 0,
    deathAnimationTimer: 0,
    deathAnimationComplete: false
};

// ============================================
// RAZORS (OBSTACLES) ARRAY
// ============================================

let razors = [];

// ============================================
// IMAGE LOADING
// ============================================

const images = {
    flap: [],
    die: [],
    razor: null
};

let imagesLoaded = 0;
const totalImages = 7;

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            imagesLoaded++;
            resolve(img);
        };
        img.onerror = reject;
        img.src = src;
    });
}

async function loadAllImages() {
    try {
        // Load flap animation frames
        images.flap[0] = await loadImage('flap1.PNG');
        images.flap[1] = await loadImage('flap2.PNG');
        images.flap[2] = await loadImage('flap3.PNG');
        
        // Load death animation frames
        images.die[0] = await loadImage('die1.PNG');
        images.die[1] = await loadImage('die2.PNG');
        images.die[2] = await loadImage('die3.PNG');
        
        // Load razor
        images.razor = await loadImage('razor.PNG');
        
        console.log('All images loaded successfully!');
        return true;
    } catch (error) {
        console.error('Error loading images:', error);
        return false;
    }
}

// ============================================
// INPUT HANDLING
// ============================================

function handleInput() {
    if (gameState === GameState.READY) {
        startGame();
    } else if (gameState === GameState.PLAYING) {
        flap();
    } else if (gameState === GameState.GAME_OVER) {
        resetGame();
    }
}

// Keyboard input
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        handleInput();
    }
});

// Mouse/touch input
canvas.addEventListener('click', handleInput);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleInput();
}, { passive: false });

// Restart button
restartBtn.addEventListener('click', resetGame);

// ============================================
// GAME FUNCTIONS
// ============================================

function startGame() {
    gameState = GameState.PLAYING;
    gameOverScreen.classList.add('hidden');
    score = 0;
    razorSpawnTimer = RAZOR_SPAWN_INTERVAL; // Spawn first razor immediately
}

function flap() {
    // Set velocity directly (authentic Flappy Bird feel)
    player.velocity = JUMP_VELOCITY;
    player.rotation = JUMP_ROTATION;
    player.currentFrame = 0;
    player.animationTimer = 0;
}

function die() {
    gameState = GameState.DYING;
    player.deathFrame = 0;
    player.deathAnimationTimer = 0;
    player.deathAnimationComplete = false;
}

function showGameOver() {
    gameState = GameState.GAME_OVER;
    finalScoreEl.textContent = score;
    gameOverScreen.classList.remove('hidden');
}

function resetGame() {
    // Reset player
    player.x = PLAYER_X;
    player.y = PLAYER_START_Y;
    player.velocity = 0;
    player.rotation = 0;
    player.currentFrame = 0;
    player.animationTimer = 0;
    player.isFlapping = true;
    player.deathFrame = 0;
    player.deathAnimationTimer = 0;
    player.deathAnimationComplete = false;
    
    // Clear razors
    razors = [];
    razorSpawnTimer = 0;
    
    // Reset score
    score = 0;
    
    // Start game
    startGame();
}

// ============================================
// RAZOR MANAGEMENT
// ============================================

function spawnRazor() {
    // Random gap position
    const gapY = MIN_RAZOR_Y + Math.random() * (MAX_RAZOR_Y - MIN_RAZOR_Y);
    
    razors.push({
        x: GAME_WIDTH,
        gapY: gapY,
        scored: false
    });
}

function updateRazors(deltaTime) {
    // Spawn timer
    razorSpawnTimer += deltaTime;
    if (razorSpawnTimer >= RAZOR_SPAWN_INTERVAL) {
        spawnRazor();
        razorSpawnTimer = 0;
    }
    
    // Update razor positions
    for (let i = razors.length - 1; i >= 0; i--) {
        const razor = razors[i];
        razor.x -= RAZOR_SPEED;
        
        // Remove off-screen razors
        if (razor.x + RAZOR_WIDTH < 0) {
            razors.splice(i, 1);
            continue;
        }
        
        // Score when passing
        if (!razor.scored && razor.x + RAZOR_WIDTH < player.x) {
            razor.scored = true;
            score++;
        }
    }
}

// ============================================
// COLLISION DETECTION
// ============================================

function checkCollisions() {
    // Player hitbox (shrunk for fairness)
    const playerLeft = player.x + HITBOX_PADDING;
    const playerRight = player.x + PLAYER_WIDTH - HITBOX_PADDING;
    const playerTop = player.y + HITBOX_PADDING;
    const playerBottom = player.y + PLAYER_HEIGHT - HITBOX_PADDING;
    
    // Floor collision
    if (playerBottom >= GAME_HEIGHT) {
        player.y = GAME_HEIGHT - PLAYER_HEIGHT + HITBOX_PADDING;
        return true;
    }
    
    // Ceiling collision
    if (playerTop <= 0) {
        player.y = -HITBOX_PADDING;
        player.velocity = 0;
    }
    
    // Razor collision
    for (const razor of razors) {
        // Top razor hitbox
        const topRazorBottom = razor.gapY;
        const topRazorLeft = razor.x + 17;  // Small padding for blade
        const topRazorRight = razor.x + RAZOR_WIDTH - 17;
        
        // Bottom razor hitbox
        const bottomRazorTop = razor.gapY + RAZOR_GAP;
        const bottomRazorLeft = razor.x + 17;
        const bottomRazorRight = razor.x + RAZOR_WIDTH - 17;
        
        // Check top razor collision
        if (playerRight > topRazorLeft && 
            playerLeft < topRazorRight && 
            playerTop < topRazorBottom) {
            return true;
        }
        
        // Check bottom razor collision
        if (playerRight > bottomRazorLeft && 
            playerLeft < bottomRazorRight && 
            playerBottom > bottomRazorTop) {
            return true;
        }
    }
    
    return false;
}

// ============================================
// UPDATE FUNCTIONS
// ============================================

function updatePlayer(deltaTime) {
    if (gameState === GameState.PLAYING || gameState === GameState.DYING) {
        // Apply gravity
        player.velocity += GRAVITY;
        
        // Cap fall speed
        if (player.velocity > MAX_FALL_SPEED) {
            player.velocity = MAX_FALL_SPEED;
        }
        
        // Update position
        player.y += player.velocity;
        
        // Update rotation based on velocity
        if (player.velocity > 0) {
            // Falling - rotate toward nose-dive
            player.rotation += ROTATION_SPEED;
            if (player.rotation > MAX_ROTATION) {
                player.rotation = MAX_ROTATION;
            }
        }
    }
    
    // Update flap animation
    if (gameState === GameState.PLAYING) {
        player.animationTimer += deltaTime;
        if (player.animationTimer >= FLAP_ANIMATION_SPEED) {
            player.animationTimer = 0;
            player.currentFrame = (player.currentFrame + 1) % 3;
        }
    }
    
    // Update death animation
    if (gameState === GameState.DYING) {
        if (!player.deathAnimationComplete) {
            player.deathAnimationTimer += deltaTime;
            if (player.deathAnimationTimer >= DEATH_ANIMATION_SPEED) {
                player.deathAnimationTimer = 0;
                player.deathFrame++;
                if (player.deathFrame >= 3) {
                    player.deathFrame = 2; // Stay on last frame
                    player.deathAnimationComplete = true;
                }
            }
        }
        
        // Check if hit floor during death
        if (player.y + PLAYER_HEIGHT >= GAME_HEIGHT) {
            player.y = GAME_HEIGHT - PLAYER_HEIGHT;
            player.velocity = 0;
            showGameOver();
        }
    }
}

function update(deltaTime) {
    if (gameState === GameState.PLAYING) {
        updatePlayer(deltaTime);
        updateRazors(deltaTime);
        
        // Check collisions
        if (checkCollisions()) {
            die();
        }
    } else if (gameState === GameState.DYING) {
        updatePlayer(deltaTime);
    }
}

// ============================================
// RENDER FUNCTIONS
// ============================================

function drawPlayer() {
    ctx.save();
    
    // Move to player center for rotation
    const centerX = player.x + PLAYER_WIDTH / 2;
    const centerY = player.y + PLAYER_HEIGHT / 2;
    
    ctx.translate(centerX, centerY);
    ctx.rotate(player.rotation * Math.PI / 180);
    
    // Select correct sprite
    let sprite;
    if (gameState === GameState.DYING || gameState === GameState.GAME_OVER) {
        sprite = images.die[player.deathFrame];
    } else {
        sprite = images.flap[player.currentFrame];
    }
    
    // Draw sprite centered
    if (sprite) {
        ctx.drawImage(
            sprite,
            -PLAYER_WIDTH / 2,
            -PLAYER_HEIGHT / 2,
            PLAYER_WIDTH,
            PLAYER_HEIGHT
        );
    }
    
    ctx.restore();
}

function drawRazors() {
    // Trading candle colors
    const RED_CANDLE = '#EF5350';   // Red for top (bearish)
    const GREEN_CANDLE = '#26A69A'; // Green for bottom (bullish)
    
    for (const razor of razors) {
        // Calculate razor dimensions
        const razorAspect = images.razor.height / images.razor.width;
        const singleRazorHeight = RAZOR_WIDTH * razorAspect;
        
        // ===== TOP OBSTACLE (RED) =====
        ctx.save();
        const topBarHeight = razor.gapY - singleRazorHeight;
        
        // Draw red bar first (from top of screen to where razor starts)
        if (topBarHeight > 0) {
            ctx.fillStyle = RED_CANDLE;
            ctx.fillRect(
                razor.x + 10,
                0,
                RAZOR_WIDTH - 20,
                topBarHeight
            );
        }
        
        // Draw top razor (rotated 180 degrees - blade pointing down)
        // Position it flush against the bottom of the red bar
        const topCenterX = razor.x + RAZOR_WIDTH / 2;
        ctx.translate(topCenterX, razor.gapY);
        ctx.rotate(Math.PI); // 180 degrees
        
        ctx.drawImage(
            images.razor,
            -RAZOR_WIDTH / 2,
            0,
            RAZOR_WIDTH,
            singleRazorHeight
        );
        
        ctx.restore();
        
        // ===== BOTTOM OBSTACLE (GREEN) =====
        ctx.save();
        const bottomY = razor.gapY + RAZOR_GAP;
        const bottomRazorEnd = bottomY + singleRazorHeight;
        
        // Draw bottom razor (normal orientation - blade pointing up)
        ctx.drawImage(
            images.razor,
            razor.x,
            bottomY,
            RAZOR_WIDTH,
            singleRazorHeight
        );
        
        // Draw green bar (from bottom of razor to bottom of screen)
        if (bottomRazorEnd < GAME_HEIGHT) {
            ctx.fillStyle = GREEN_CANDLE;
            ctx.fillRect(
                razor.x + 10,
                bottomRazorEnd,
                RAZOR_WIDTH - 20,
                GAME_HEIGHT - bottomRazorEnd
            );
        }
        
        ctx.restore();
    }
}

function drawScore() {
    if (gameState === GameState.PLAYING || gameState === GameState.DYING) {
        ctx.save();
        ctx.font = 'bold 120px "Creepster", cursive';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        // Draw shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillText(score.toString(), GAME_WIDTH / 2 + 5, 88);
        
        // Draw score
        ctx.fillStyle = '#000000';
        ctx.fillText(score.toString(), GAME_WIDTH / 2, 85);
        
        ctx.restore();
    }
}

function drawStartScreen(deltaTime) {
    // Update animation timer
    startScreenAnimTimer += deltaTime;
    
    // Update flap animation (150ms per frame for smooth loop)
    if (startScreenAnimTimer >= 150) {
        startScreenAnimTimer = 0;
        startScreenFlapFrame = (startScreenFlapFrame + 1) % 3;
        startScreenDieFrame = (startScreenDieFrame + 1) % 3;
    }
    
    // Draw title
    ctx.save();
    ctx.font = 'bold 108px "Creepster", cursive';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText('FLAP EMONAD', GAME_WIDTH / 2 + 4, 174);
    ctx.fillStyle = '#000000';
    ctx.fillText('FLAP EMONAD', GAME_WIDTH / 2, 170);
    ctx.restore();
    
    // Draw flying character on top half (looping flap animation)
    const flapSprite = images.flap[startScreenFlapFrame];
    if (flapSprite) {
        ctx.save();
        const flapX = GAME_WIDTH / 2;
        const flapY = GAME_HEIGHT * 0.35;
        ctx.translate(flapX, flapY);
        // Slight bobbing motion
        const bob = Math.sin(Date.now() / 200) * 10;
        ctx.drawImage(
            flapSprite,
            -170,
            -170 + bob,
            340,
            340
        );
        ctx.restore();
    }
    
    // Draw "Click to Start" text in middle
    ctx.save();
    ctx.font = '48px "Creepster", cursive';
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Pulsing opacity
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 500);
    ctx.globalAlpha = pulse;
    ctx.fillText('Click or Press Space to Start', GAME_WIDTH / 2, GAME_HEIGHT / 2);
    ctx.restore();
    
    // Draw dying character on bottom half (looping death animation)
    const dieSprite = images.die[startScreenDieFrame];
    if (dieSprite) {
        ctx.save();
        const dieX = GAME_WIDTH / 2;
        const dieY = GAME_HEIGHT * 0.7;
        ctx.translate(dieX, dieY);
        // Slight wobble
        const wobble = Math.sin(Date.now() / 150) * 5;
        ctx.rotate(wobble * Math.PI / 180);
        ctx.drawImage(
            dieSprite,
            -170,
            -170,
            340,
            340
        );
        ctx.restore();
    }
}

function render(deltaTime) {
    // Clear canvas with white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    
    // Draw game elements based on state
    if (gameState === GameState.READY) {
        drawStartScreen(deltaTime);
    } else {
        drawRazors();
        drawPlayer();
        drawScore();
    }
}

// ============================================
// GAME LOOP
// ============================================

function gameLoop(currentTime) {
    // Calculate delta time
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    // Update and render
    update(deltaTime);
    render(deltaTime);
    
    // Continue loop
    requestAnimationFrame(gameLoop);
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
    console.log('Initializing Flap Emonad...');
    
    // Load images
    const loaded = await loadAllImages();
    if (!loaded) {
        console.error('Failed to load images!');
        return;
    }
    
    // Start game loop
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    
    console.log('Game ready!');
}

// Start the game
init();
