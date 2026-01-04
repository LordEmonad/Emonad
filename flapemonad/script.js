// ============================================
// FLAP EMONAD - A Flappy Bird Clone
// With On-Chain Leaderboard on Monad
// ============================================

// ============================================
// BLOCKCHAIN CONFIGURATION
// ============================================

// Monad Network Configuration
const MONAD_CHAIN_ID = 143;
const MONAD_RPC = 'https://rpc.monad.xyz';
const MONAD_CHAIN_CONFIG = {
    chainId: '0x8f', // 143 in hex
    chainName: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: ['https://rpc.monad.xyz'],
    blockExplorerUrls: ['https://monadscan.com']
};

// Leaderboard Contract (UPDATE AFTER DEPLOYMENT)
const LEADERBOARD_ADDRESS = '0x7fffA7d3FF68A8781d3cc724810ddb03601D9642'; // TODO: Set after deployment
const REFEREE_SERVER_URL = 'https://felt-majority-alan-pair.trycloudflare.com';

// Leaderboard Contract ABI (minimal)
const LEADERBOARD_ABI = [
    'function submitScore(uint256 _score, uint256 _nonce, string memory _name, bytes memory _signature) external',
    'function getHighScore(address _player) external view returns (uint256)',
    'function getNonce(address _player) external view returns (uint256)',
    'function getName(address _player) external view returns (string memory)',
    'function getTopScores(uint256 _count) external view returns (address[] memory, string[] memory, uint256[] memory)',
    'function getPlayerCount() external view returns (uint256)',
    'event NewHighScore(address indexed player, string name, uint256 score, uint256 timestamp)'
];

// Wallet state
let provider = null;
let signer = null;
let userAddress = null;
let isWalletConnected = false;

// Game timing for anti-cheat
let gameStartTime = 0;

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

// Target frame rate for consistent physics
const TARGET_FPS = 60;
const TARGET_FRAME_TIME = 1000 / TARGET_FPS; // ~16.67ms

// Physics (tuned to feel like original Flappy Bird, scaled for high res)
const GRAVITY = 1.2;               // Gravity acceleration per frame (at 60fps)
const JUMP_VELOCITY = -24;         // Velocity set on flap (not added)
const MAX_FALL_SPEED = 34;         // Terminal velocity
const ROTATION_SPEED = 4;          // Degrees per frame when falling (at 60fps)
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
const RAZOR_SPEED = 8.5;           // Pixels per frame (at 60fps)
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
        // Don't trigger game actions if typing in an input field
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            return;
        }
        e.preventDefault();
        handleInput();
    }
});

// Mouse/touch input with leaderboard button detection
canvas.addEventListener('click', (e) => {
    // Check if clicking leaderboard button on start screen
    if (gameState === GameState.READY && window.startScreenLeaderboardBtn) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = GAME_WIDTH / rect.width;
        const scaleY = GAME_HEIGHT / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;
        
        const btn = window.startScreenLeaderboardBtn;
        if (clickX >= btn.x && clickX <= btn.x + btn.width &&
            clickY >= btn.y && clickY <= btn.y + btn.height) {
            window.location.href = 'leaderboard.html';
            return;
        }
    }
    handleInput();
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    
    // Check if touching leaderboard button on start screen
    if (gameState === GameState.READY && window.startScreenLeaderboardBtn && e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = GAME_WIDTH / rect.width;
        const scaleY = GAME_HEIGHT / rect.height;
        const touchX = (e.touches[0].clientX - rect.left) * scaleX;
        const touchY = (e.touches[0].clientY - rect.top) * scaleY;
        
        const btn = window.startScreenLeaderboardBtn;
        if (touchX >= btn.x && touchX <= btn.x + btn.width &&
            touchY >= btn.y && touchY <= btn.y + btn.height) {
            window.location.href = 'leaderboard.html';
            return;
        }
    }
    handleInput();
}, { passive: false });

// Restart button with click sound
restartBtn.addEventListener('click', () => {
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.playClick();
    }
    resetGame();
});

// ============================================
// GAME FUNCTIONS
// ============================================

function startGame() {
    gameState = GameState.PLAYING;
    gameOverScreen.classList.add('hidden');
    score = 0;
    razorSpawnTimer = RAZOR_SPAWN_INTERVAL; // Spawn first razor immediately
    gameStartTime = Date.now(); // Track start time for anti-cheat
    
    // Start music (random track)
    if (typeof chiptunePlayer !== 'undefined') {
        const track = Math.floor(Math.random() * 3) + 1;
        chiptunePlayer.playTrack(track);
    }
}

function flap() {
    // Set velocity directly (authentic Flappy Bird feel)
    player.velocity = JUMP_VELOCITY;
    player.rotation = JUMP_ROTATION;
    player.currentFrame = 0;
    player.animationTimer = 0;
    
    // Play flap sound
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.playFlap();
    }
}

function die() {
    gameState = GameState.DYING;
    player.deathFrame = 0;
    player.deathAnimationTimer = 0;
    player.deathAnimationComplete = false;
    
    // Stop music and play death sound
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.stop();
        chiptunePlayer.playDeath();
    }
}

function showGameOver() {
    gameState = GameState.GAME_OVER;
    finalScoreEl.textContent = score;
    gameOverScreen.classList.remove('hidden');
    
    // Play game over music quickly after death sound starts
    if (typeof chiptunePlayer !== 'undefined') {
        setTimeout(() => {
            chiptunePlayer.playGameOverMusic();
        }, 600); // Quick transition
    }
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
    // Normalize delta time to target 60fps for consistent physics
    const timeScale = deltaTime / TARGET_FRAME_TIME;
    
    // Spawn timer
    razorSpawnTimer += deltaTime;
    if (razorSpawnTimer >= RAZOR_SPAWN_INTERVAL) {
        spawnRazor();
        razorSpawnTimer = 0;
    }
    
    // Update razor positions (scaled by time)
    for (let i = razors.length - 1; i >= 0; i--) {
        const razor = razors[i];
        razor.x -= RAZOR_SPEED * timeScale;
        
        // Remove off-screen razors
        if (razor.x + RAZOR_WIDTH < 0) {
            razors.splice(i, 1);
            continue;
        }
        
        // Score when passing
        if (!razor.scored && razor.x + RAZOR_WIDTH < player.x) {
            razor.scored = true;
            score++;
            
            // Play score sound
            if (typeof chiptunePlayer !== 'undefined') {
                chiptunePlayer.playScore();
            }
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
    // Normalize delta time to target 60fps for consistent physics
    const timeScale = deltaTime / TARGET_FRAME_TIME;
    
    if (gameState === GameState.PLAYING || gameState === GameState.DYING) {
        // Apply gravity (scaled by time)
        player.velocity += GRAVITY * timeScale;
        
        // Cap fall speed
        if (player.velocity > MAX_FALL_SPEED) {
            player.velocity = MAX_FALL_SPEED;
        }
        
        // Update position (scaled by time)
        player.y += player.velocity * timeScale;
        
        // Update rotation based on velocity (scaled by time)
        if (player.velocity > 0) {
            // Falling - rotate toward nose-dive
            player.rotation += ROTATION_SPEED * timeScale;
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
        const dieY = GAME_HEIGHT * 0.65;
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
    
    // Draw "View Leaderboard" button
    ctx.save();
    const lbBtnY = GAME_HEIGHT * 0.88;
    const lbBtnWidth = 400;
    const lbBtnHeight = 70;
    const lbBtnX = GAME_WIDTH / 2 - lbBtnWidth / 2;
    
    // Button background
    const gradient = ctx.createLinearGradient(lbBtnX, lbBtnY, lbBtnX + lbBtnWidth, lbBtnY);
    gradient.addColorStop(0, '#FFD700');
    gradient.addColorStop(1, '#FFA500');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(lbBtnX, lbBtnY, lbBtnWidth, lbBtnHeight, 15);
    ctx.fill();
    
    // Button text
    ctx.font = '36px "Creepster", cursive';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 View Leaderboard', GAME_WIDTH / 2, lbBtnY + lbBtnHeight / 2);
    ctx.restore();
    
    // Store button bounds for click detection
    window.startScreenLeaderboardBtn = {
        x: lbBtnX,
        y: lbBtnY,
        width: lbBtnWidth,
        height: lbBtnHeight
    };
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

// Loading screen progress
let loadingProgress = 0;
let gameReady = false;

function updateLoadingBar(progress) {
    const bar = document.getElementById('loading-bar');
    const text = document.getElementById('loading-text');
    if (bar) bar.style.width = progress + '%';
    
    if (progress < 30) {
        if (text) text.textContent = 'Loading assets...';
    } else if (progress < 60) {
        if (text) text.textContent = 'Loading music...';
    } else if (progress < 90) {
        if (text) text.textContent = 'Almost ready...';
    } else {
        if (text) text.textContent = 'Ready!';
    }
}

function showPlayButton() {
    const playBtn = document.getElementById('play-btn');
    const loadingText = document.getElementById('loading-text');
    if (playBtn) {
        playBtn.classList.add('show');
    }
    if (loadingText) {
        loadingText.textContent = 'Ready!';
    }
    gameReady = true;
}

function dismissLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const soundBtn = document.getElementById('sound-toggle-btn');
    
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
    
    // Show sound toggle button
    if (soundBtn) {
        soundBtn.style.display = 'block';
    }
    
    // Start the menu music immediately (user clicked, so audio is allowed)
    if (typeof chiptunePlayer !== 'undefined') {
        // Initialize audio context on user interaction (required for mobile)
        chiptunePlayer.init();
        
        // Resume audio context if suspended (mobile browsers require this)
        if (chiptunePlayer.audioContext && chiptunePlayer.audioContext.state === 'suspended') {
            chiptunePlayer.audioContext.resume();
        }
        
        // Play menu music if not muted
        if (!chiptunePlayer.isMuted) {
            chiptunePlayer.playMenuMusic();
        }
    }
}

// Called when user clicks PLAY button
function startGameFromLoading() {
    // Initialize audio context FIRST on user tap (required for mobile)
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.init();
        
        // Resume audio context if suspended (mobile browsers require this)
        if (chiptunePlayer.audioContext && chiptunePlayer.audioContext.state === 'suspended') {
            chiptunePlayer.audioContext.resume().then(() => {
                chiptunePlayer.playClick();
                dismissLoadingScreen();
            });
            return;
        }
        
        chiptunePlayer.playClick();
    }
    
    dismissLoadingScreen();
}

async function init() {
    console.log('Initializing Flap Emonad...');
    
    try {
        // Simulate loading progress
        updateLoadingBar(10);
        
        // Load images
        updateLoadingBar(30);
        const loaded = await loadAllImages();
        if (!loaded) {
            console.error('Failed to load images - continuing anyway');
        }
        
        updateLoadingBar(60);
        
        // Initialize audio system
        if (typeof chiptunePlayer !== 'undefined') {
            chiptunePlayer.init();
        }
        
        updateLoadingBar(80);
        
        // Start game loop
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
        
        updateLoadingBar(100);
        
        console.log('Game ready!');
        
        // Show play button after a tiny delay for smooth animation
        setTimeout(() => {
            showPlayButton();
        }, 300);
    } catch (error) {
        console.error('Init error:', error);
        // Still show play button so user isn't stuck
        showPlayButton();
    }
}

// Toggle sound on/off
function toggleSound() {
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.playClick();
        const isMuted = chiptunePlayer.toggleMute();
        
        // Update button icons
        const icon = isMuted ? '🔇' : '🔊';
        const btn1 = document.getElementById('sound-toggle-btn');
        const btn2 = document.getElementById('sound-toggle-btn-gameover');
        if (btn1) btn1.textContent = icon;
        if (btn2) btn2.textContent = icon;
    }
}

// ============================================
// WALLET & BLOCKCHAIN FUNCTIONS
// ============================================

async function connectWallet() {
    // Check if running from file:// protocol (wallets don't work there)
    if (window.location.protocol === 'file:') {
        alert('⚠️ Wallet connection requires a web server!\n\n' +
            'Wallets cannot connect when opening HTML files directly.\n\n' +
            'To enable wallet connection:\n' +
            '1. Deploy this site to a hosting service, OR\n' +
            '2. Run a local server:\n' +
            '   - Open terminal in this folder\n' +
            '   - Run: python -m http.server 8080\n' +
            '   - Open: http://localhost:8080\n\n' +
            'You can still play the game - just can\'t submit scores on-chain.');
        return false;
    }
    
    // Get the Ethereum provider
    const getProvider = () => {
        // Phantom's dedicated namespace
        if (window.phantom?.ethereum) {
            return window.phantom.ethereum;
        }
        // Standard ethereum provider
        if (window.ethereum) {
            if (window.ethereum.providers?.length) {
                return window.ethereum.providers.find(p => p.isPhantom) || window.ethereum.providers[0];
            }
            return window.ethereum;
        }
        return null;
    };
    
    let ethereumProvider = getProvider();
    
    // Wait a moment if not found (provider might still be loading)
    if (!ethereumProvider) {
        await new Promise(r => setTimeout(r, 1000));
        ethereumProvider = getProvider();
    }
    
    if (!ethereumProvider) {
        alert('No wallet detected!\n\n' +
            'Make sure Phantom or MetaMask is:\n' +
            '1. Installed in your browser\n' +
            '2. Set to an EVM network (Ethereum, not Solana)\n' +
            '3. Unlocked\n\n' +
            'Then refresh this page and try again.');
        return false;
    }
    
    console.log('Using provider:', ethereumProvider);
    
    try {
        // Request account access
        const accounts = await ethereumProvider.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];
        
        // Create provider and signer
        provider = new ethers.BrowserProvider(ethereumProvider);
        signer = await provider.getSigner();
        
        // Check if on Monad network
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== MONAD_CHAIN_ID) {
            // Try to switch to Monad
            try {
                await ethereumProvider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: MONAD_CHAIN_CONFIG.chainId }]
                });
            } catch (switchError) {
                // Chain not added, try to add it
                if (switchError.code === 4902) {
                    await ethereumProvider.request({
                        method: 'wallet_addEthereumChain',
                        params: [MONAD_CHAIN_CONFIG]
                    });
                } else {
                    throw switchError;
                }
            }
            // Refresh provider after network switch
            provider = new ethers.BrowserProvider(ethereumProvider);
            signer = await provider.getSigner();
        }
        
        isWalletConnected = true;
        updateWalletUI();
        console.log('Wallet connected:', userAddress);
        return true;
        
    } catch (err) {
        console.error('Wallet connection failed:', err);
        alert('Failed to connect wallet: ' + err.message);
        return false;
    }
}

function disconnectWallet() {
    provider = null;
    signer = null;
    userAddress = null;
    isWalletConnected = false;
    updateWalletUI();
}

function updateWalletUI() {
    const connectBtn = document.getElementById('connect-wallet-btn');
    const walletInfo = document.getElementById('wallet-info');
    const submitBtn = document.getElementById('submit-score-btn');
    
    if (isWalletConnected && userAddress) {
        const shortAddress = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
        if (connectBtn) connectBtn.textContent = shortAddress;
        if (walletInfo) walletInfo.textContent = shortAddress;
        if (submitBtn) submitBtn.disabled = false;
    } else {
        if (connectBtn) connectBtn.textContent = 'Connect Wallet';
        if (walletInfo) walletInfo.textContent = '';
        if (submitBtn) submitBtn.disabled = true;
    }
}

async function submitScoreToBlockchain() {
    if (!isWalletConnected) {
        const connected = await connectWallet();
        if (!connected) return;
    }
    
    if (LEADERBOARD_ADDRESS === '0x0000000000000000000000000000000000000000') {
        alert('Leaderboard contract not deployed yet!');
        return;
    }
    
    // Get player name from input
    const nameInput = document.getElementById('player-name-input');
    let playerName = nameInput ? nameInput.value.trim() : '';
    
    // Require name if input is not disabled (first time submitting)
    if (nameInput && !nameInput.disabled && playerName.length === 0) {
        alert('Please enter a name for the leaderboard!');
        nameInput.focus();
        return;
    }
    
    // Validate name length
    if (playerName.length > 20) {
        playerName = playerName.substring(0, 20);
    }
    
    const gameDuration = Date.now() - gameStartTime;
    const currentScore = score;
    
    try {
        // Show loading state
        const submitBtn = document.getElementById('submit-score-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Validating...';
        }
        
        // 1. Get current nonce from server
        const nonceResponse = await fetch(`${REFEREE_SERVER_URL}/api/nonce/${userAddress}`);
        const nonceData = await nonceResponse.json();
        const nonce = parseInt(nonceData.nonce);
        
        // 2. Request signature from referee server
        const signResponse = await fetch(`${REFEREE_SERVER_URL}/api/sign-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerAddress: userAddress,
                score: currentScore,
                gameDurationMs: gameDuration,
                nonce: nonce
            })
        });
        
        const signData = await signResponse.json();
        
        if (signData.error) {
            alert('Score rejected: ' + signData.error);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Score';
            }
            return;
        }
        
        const signature = signData.signature;
        
        // 3. Submit to blockchain with name
        if (submitBtn) submitBtn.textContent = 'Submitting...';
        
        const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, signer);
        const tx = await contract.submitScore(currentScore, nonce, playerName, signature);
        
        if (submitBtn) submitBtn.textContent = 'Confirming...';
        await tx.wait();
        
        // Store TX hash on server for leaderboard display
        try {
            await fetch(`${REFEREE_SERVER_URL}/api/tx-hash`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerAddress: userAddress,
                    txHash: tx.hash,
                    score: currentScore
                })
            });
        } catch (e) {
            console.warn('Could not store TX hash:', e);
        }
        
        alert('Score submitted on-chain! 🎉');
        
        // Refresh leaderboard
        await loadLeaderboard();
        
    } catch (err) {
        console.error('Score submission failed:', err);
        alert('Failed to submit score: ' + (err.reason || err.message));
    } finally {
        const submitBtn = document.getElementById('submit-score-btn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Score';
        }
    }
}

async function loadLeaderboard() {
    if (LEADERBOARD_ADDRESS === '0x0000000000000000000000000000000000000000') {
        return;
    }
    
    try {
        const readProvider = new ethers.JsonRpcProvider(MONAD_RPC);
        const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, readProvider);
        
        // Get top 10 scores with names
        const [players, names, scores] = await contract.getTopScores(10);
        
        const leaderboardList = document.getElementById('leaderboard-list');
        if (!leaderboardList) return;
        
        leaderboardList.innerHTML = '';
        
        for (let i = 0; i < players.length; i++) {
            if (players[i] === '0x0000000000000000000000000000000000000000') continue;
            
            // Use name if set, otherwise show shortened address
            const displayName = names[i] && names[i].length > 0 
                ? names[i] 
                : players[i].slice(0, 6) + '...' + players[i].slice(-4);
            
            const li = document.createElement('li');
            li.innerHTML = `<span class="rank">#${i + 1}</span> <span class="player-name">${displayName}</span> <span class="lb-score">${scores[i]}</span>`;
            
            // Highlight current user
            if (userAddress && players[i].toLowerCase() === userAddress.toLowerCase()) {
                li.classList.add('current-user');
            }
            
            leaderboardList.appendChild(li);
        }
        
        // Get player's high score and name if connected
        if (userAddress) {
            const myHighScore = await contract.getHighScore(userAddress);
            const myScoreEl = document.getElementById('my-high-score');
            if (myScoreEl) myScoreEl.textContent = myHighScore.toString();
            
            // Check if player already has a name set
            const myName = await contract.getName(userAddress);
            const nameInput = document.getElementById('player-name-input');
            if (nameInput && myName && myName.length > 0) {
                nameInput.value = myName;
                nameInput.disabled = true;
                nameInput.placeholder = myName;
            }
        }
        
    } catch (err) {
        console.error('Failed to load leaderboard:', err);
    }
}

// Listen for account changes
if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else {
            userAddress = accounts[0];
            updateWalletUI();
        }
    });
    
    window.ethereum.on('chainChanged', () => {
        window.location.reload();
    });
}


// Start the game
init();

// Load leaderboard on page load
setTimeout(loadLeaderboard, 1000);
