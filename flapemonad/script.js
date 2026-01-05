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
    blockExplorerUrls: ['https://monadvision.com']
};

// Leaderboard Contract (UPDATE AFTER DEPLOYMENT)
const LEADERBOARD_ADDRESS = '0x7fffA7d3FF68A8781d3cc724810ddb03601D9642'; // TODO: Set after deployment
const REFEREE_SERVER_URL = 'https://api.emonad.lol';

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
const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for performance

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

// Target frame rate for consistent physics (game runs at any FPS but physics are normalized)
const TARGET_FPS = 60;
const TARGET_FRAME_TIME = 1000 / TARGET_FPS; // ~16.67ms - physics reference frame

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

// Death impact effects
let screenShake = {
    active: false,
    intensity: 0,
    duration: 0,
    elapsed: 0
};
let screenFlash = {
    active: false,
    color: 'rgba(255, 0, 0, 0.6)',
    duration: 0,
    elapsed: 0,
    phase: 0  // 0 = flash in, 1 = hold, 2 = fade out
};

// Death certificate data
let deathCertificate = {
    killerRazor: null,  // The razor that killed the player
    deathType: 'razor', // 'razor', 'floor', 'ceiling'
    finalScore: 0,
    timestamp: null
};

// Slow-motion death effect
let deathSlowMo = {
    active: false,
    timeScale: 1.0,      // 1.0 = normal, 0.2 = slow
    targetScale: 0.2,    // How slow to go
    duration: 800,       // Total slow-mo duration
    elapsed: 0,
    zoom: 1.0,           // Camera zoom
    targetZoom: 1.15,    // Zoom in slightly
    desaturation: 0      // 0 = full color, 1 = grayscale
};

// Top 3 leaderboard scores for start screen
let topScores = [];

// Score particles system
let scoreParticles = [];

// Player trail system
let playerTrail = [];
const MAX_TRAIL_LENGTH = 8;

// Background clouds
let clouds = [];
const NUM_CLOUDS = 6;

// Background particles for in-game
let bgParticles = [];
const NUM_BG_PARTICLES = 20;

// Start screen particles (separate from in-game)
let startScreenParticles = [];
const NUM_START_PARTICLES = 30;

// Screen transition for fade effect
let screenTransition = {
    active: false,
    alpha: 1,
    duration: 400,
    elapsed: 0
};

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

// Home button - go back to start screen
const homeBtn = document.getElementById('home-btn');
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        if (typeof chiptunePlayer !== 'undefined') {
            chiptunePlayer.playClick();
        }
        goToStartScreen();
    });
}

function goToStartScreen() {
    // Reset game state to READY (start screen)
    gameState = GameState.READY;
    gameOverScreen.classList.add('hidden');
    
    // Reset player position
    player.y = PLAYER_START_Y;
    player.velocity = 0;
    player.rotation = 0;
    player.flapFrame = 0;
    
    // Clear razors
    razors.length = 0;
    
    // Reset score
    score = 0;
    
    // Stop game music, play menu music
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.stopMusic();
        if (!chiptunePlayer.isMuted) {
            chiptunePlayer.playMenuMusic();
        }
    }
}

// ============================================
// GAME FUNCTIONS
// ============================================

function startGame() {
    gameState = GameState.PLAYING;
    gameOverScreen.classList.add('hidden');
    score = 0;
    razorSpawnTimer = RAZOR_SPAWN_INTERVAL; // Spawn first razor immediately
    gameStartTime = Date.now(); // Track start time for anti-cheat
    
    // Reset effects
    scoreParticles = [];
    initBackgroundParticles();
    
    // Start fade transition from dark to white
    screenTransition.active = true;
    screenTransition.alpha = 1;
    screenTransition.elapsed = 0;
    
    // Start music (random track)
    if (typeof chiptunePlayer !== 'undefined') {
        const track = Math.floor(Math.random() * 3) + 1;
        chiptunePlayer.playTrack(track);
    }
}

// Initialize background particles for white background gameplay
function initBackgroundParticles() {
    bgParticles = [];
    for (let i = 0; i < 25; i++) {  // More particles
        bgParticles.push({
            x: Math.random() * GAME_WIDTH,
            y: Math.random() * GAME_HEIGHT,
            size: 4 + Math.random() * 8,  // Larger particles
            speed: 0.8 + Math.random() * 1.2,  // Faster upward movement
            opacity: 0.15 + Math.random() * 0.25,  // More visible
            color: Math.random() > 0.4 ? '#9d4edd' : '#c77dff'  // Purple colors
        });
    }
}

// Draw purple floating particles during gameplay (white background)
function drawBackgroundParticles() {
    for (const p of bgParticles) {
        // Move particle upward
        p.y -= p.speed;
        p.x += Math.sin(Date.now() / 1500 + p.y / 80) * 0.5; // Gentle sway
        
        // Wrap around when off top
        if (p.y < -20) {
            p.y = GAME_HEIGHT + 20;
            p.x = Math.random() * GAME_WIDTH;
        }
        
        // Draw particle with glow
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Initialize start screen particles
function initStartScreenParticles() {
    startScreenParticles = [];
    for (let i = 0; i < NUM_START_PARTICLES; i++) {
        startScreenParticles.push({
            x: Math.random() * GAME_WIDTH,
            y: Math.random() * GAME_HEIGHT,
            size: 2 + Math.random() * 5,
            speed: 0.4 + Math.random() * 0.6,
            opacity: 0.15 + Math.random() * 0.25,
            color: Math.random() > 0.6 ? '#9d4edd' : (Math.random() > 0.5 ? '#e0aaff' : '#ffffff')
        });
    }
}

// Draw start screen particles
function drawStartScreenParticles() {
    // Initialize if empty
    if (startScreenParticles.length === 0) {
        initStartScreenParticles();
    }
    
    for (const p of startScreenParticles) {
        // Move particle slowly upward
        p.y -= p.speed;
        p.x += Math.sin(Date.now() / 3000 + p.y / 150) * 0.4; // Gentle sway
        
        // Wrap around
        if (p.y < -10) {
            p.y = GAME_HEIGHT + 10;
            p.x = Math.random() * GAME_WIDTH;
        }
        
        // Draw particle with glow
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Flap counter - DISABLED FOR NOW
// let pendingFlaps = 0;
// setInterval(() => {
//     if (pendingFlaps > 0) {
//         const flapsToSend = pendingFlaps;
//         pendingFlaps = 0;
//         fetch(`${REFEREE_SERVER_URL}/api/flap/batch`, { 
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ count: flapsToSend })
//         }).catch(() => {
//             pendingFlaps += flapsToSend;
//         });
//     }
// }, 2000);

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
    
    // Flap tracking disabled
    // pendingFlaps++;
}

function die(deathType = 'razor', killerRazor = null) {
    gameState = GameState.DYING;
    player.deathFrame = 0;
    player.deathAnimationTimer = 0;
    player.deathAnimationComplete = false;
    
    // Store death certificate data
    deathCertificate.killerRazor = killerRazor;
    deathCertificate.deathType = deathType;
    deathCertificate.finalScore = score;
    deathCertificate.timestamp = new Date();
    
    // Trigger screen shake - intense burst
    screenShake.active = true;
    screenShake.intensity = 25;  // Strong shake
    screenShake.duration = 300;  // 300ms
    screenShake.elapsed = 0;
    
    // Trigger screen flash - red impact flash
    screenFlash.active = true;
    screenFlash.color = 'rgba(255, 50, 50, 0.7)';
    screenFlash.duration = 250;  // Total flash duration
    screenFlash.elapsed = 0;
    screenFlash.phase = 0;
    
    // Trigger slow-motion death effect
    deathSlowMo.active = true;
    deathSlowMo.timeScale = 1.0;
    deathSlowMo.elapsed = 0;
    deathSlowMo.zoom = 1.0;
    deathSlowMo.desaturation = 0;
    
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
    
    // Setup tap anywhere to restart on mobile
    setupGameOverTapToRestart();
    
    // Play game over music quickly after death sound starts
    if (typeof chiptunePlayer !== 'undefined') {
        setTimeout(() => {
            chiptunePlayer.playGameOverMusic();
        }, 600); // Quick transition
    }
}

// Setup tap anywhere on game over screen to restart (mobile)
function setupGameOverTapToRestart() {
    const gameOverScreenEl = document.getElementById('game-over-screen');
    if (!gameOverScreenEl) return;
    
    // Remove any existing listener first
    gameOverScreenEl.removeEventListener('touchend', handleGameOverTap);
    gameOverScreenEl.removeEventListener('click', handleGameOverClick);
    
    // Add new listeners
    gameOverScreenEl.addEventListener('touchend', handleGameOverTap, { passive: false });
    gameOverScreenEl.addEventListener('click', handleGameOverClick);
}

function handleGameOverTap(e) {
    // Don't restart if tapping on a button, input, or link
    const target = e.target;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || 
        target.tagName === 'A' || target.closest('button') || 
        target.closest('a') || target.closest('input')) {
        return;
    }
    
    e.preventDefault();
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.playClick();
    }
    resetGame();
}

function handleGameOverClick(e) {
    // Don't restart if clicking on a button, input, or link
    const target = e.target;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || 
        target.tagName === 'A' || target.closest('button') || 
        target.closest('a') || target.closest('input')) {
        return;
    }
    
    // Only on mobile/touch devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.matchMedia && window.matchMedia('(hover: none)').matches);
    if (isMobile) {
        if (typeof chiptunePlayer !== 'undefined') {
            chiptunePlayer.playClick();
        }
        resetGame();
    }
}

// ============================================
// DEATH CERTIFICATE GENERATOR
// ============================================

// Certificate uses the already-loaded game images (images.die[2] and images.razor)

function generateDeathCertificate(playerName) {
    // Create offscreen canvas for the certificate - LANDSCAPE
    const certCanvas = document.createElement('canvas');
    const certCtx = certCanvas.getContext('2d');
    
    // Certificate dimensions - LANDSCAPE (Twitter/social media friendly)
    const CERT_WIDTH = 1920;
    const CERT_HEIGHT = 1080;
    certCanvas.width = CERT_WIDTH;
    certCanvas.height = CERT_HEIGHT;
    
    // Background - dark gradient matching game theme
    const bgGradient = certCtx.createLinearGradient(0, 0, CERT_WIDTH, CERT_HEIGHT);
    bgGradient.addColorStop(0, '#0d0505');
    bgGradient.addColorStop(0.3, '#1a0a0a');
    bgGradient.addColorStop(0.7, '#2d1515');
    bgGradient.addColorStop(1, '#1a0808');
    certCtx.fillStyle = bgGradient;
    certCtx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT);
    
    // Add subtle noise texture
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * CERT_WIDTH;
        const y = Math.random() * CERT_HEIGHT;
        const alpha = Math.random() * 0.02;
        certCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        certCtx.fillRect(x, y, 1, 1);
    }
    
    // Decorative border - double line
    certCtx.strokeStyle = '#8B0000';
    certCtx.lineWidth = 6;
    certCtx.strokeRect(30, 30, CERT_WIDTH - 60, CERT_HEIGHT - 60);
    certCtx.strokeStyle = '#4a0000';
    certCtx.lineWidth = 2;
    certCtx.strokeRect(45, 45, CERT_WIDTH - 90, CERT_HEIGHT - 90);
    
    // Corner decorations
    const cornerSize = 50;
    certCtx.fillStyle = '#8B0000';
    [[30, 30], [CERT_WIDTH - 30 - cornerSize, 30], [30, CERT_HEIGHT - 38], [CERT_WIDTH - 30 - cornerSize, CERT_HEIGHT - 38]].forEach(([x, y]) => {
        certCtx.fillRect(x, y, cornerSize, 6);
    });
    [[30, 30], [30, CERT_HEIGHT - 30 - cornerSize], [CERT_WIDTH - 36, 30], [CERT_WIDTH - 36, CERT_HEIGHT - 30 - cornerSize]].forEach(([x, y]) => {
        certCtx.fillRect(x, y, 6, cornerSize);
    });
    
    // === LEFT SECTION - Character ===
    const leftCenterX = 300;
    
    // Draw character using embedded base64 image
    const charSize = 280;
    const charImg = new Image();
    charImg.src = CERT_DIE3_BASE64;
    certCtx.drawImage(
        charImg,
        leftCenterX - charSize / 2,
        CERT_HEIGHT / 2 - charSize / 2 - 30,
        charSize,
        charSize
    );
    
    // Player name under character
    certCtx.font = 'bold 48px "Creepster", Georgia, cursive';
    certCtx.fillStyle = '#ffffff';
    certCtx.textAlign = 'center';
    certCtx.fillText(playerName || 'ANONYMOUS', leftCenterX, CERT_HEIGHT / 2 + 180);
    
    // === CENTER SECTION - Title & Info ===
    const centerX = CERT_WIDTH / 2;
    
    // Title
    certCtx.font = 'bold 72px "Creepster", Georgia, cursive';
    certCtx.fillStyle = '#8B0000';
    certCtx.textAlign = 'center';
    certCtx.fillText('DEATH CERTIFICATE', centerX, 130);
    
    // Decorative line under title
    certCtx.strokeStyle = '#8B0000';
    certCtx.lineWidth = 3;
    certCtx.beginPath();
    certCtx.moveTo(centerX - 350, 160);
    certCtx.lineTo(centerX + 350, 160);
    certCtx.stroke();
    
    // "was brutally slain by"
    certCtx.font = '36px Georgia, serif';
    certCtx.fillStyle = '#cccccc';
    certCtx.fillText('was brutally slain by', centerX, 250);
    
    // Determine razor type based on death
    let candleColor, candleLabel;
    if (deathCertificate.deathType === 'floor') {
        candleColor = '#26A69A';
        candleLabel = 'THE FLOOR';
    } else if (deathCertificate.deathType === 'razor-top') {
        candleColor = '#EF5350';
        candleLabel = 'A BEARISH RAZOR';
    } else if (deathCertificate.deathType === 'razor-bottom') {
        candleColor = '#26A69A';
        candleLabel = 'A BULLISH RAZOR';
    } else {
        candleColor = '#EF5350';
        candleLabel = 'A CRYPTO RAZOR';
    }
    
    // Candle label
    certCtx.font = 'bold 56px "Creepster", Georgia, cursive';
    certCtx.fillStyle = candleColor;
    certCtx.fillText(candleLabel, centerX, 330);
    
    // Score section
    certCtx.font = '32px Georgia, serif';
    certCtx.fillStyle = '#aaaaaa';
    certCtx.fillText('Final Score', centerX, 450);
    
    // Big score number
    certCtx.font = 'bold 180px "Creepster", Georgia, cursive';
    // Shadow
    certCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    certCtx.fillText(deathCertificate.finalScore.toString(), centerX + 5, 620);
    // Gold gradient
    const goldGradient = certCtx.createLinearGradient(0, 480, 0, 620);
    goldGradient.addColorStop(0, '#FFD700');
    goldGradient.addColorStop(0.5, '#FFF8DC');
    goldGradient.addColorStop(1, '#DAA520');
    certCtx.fillStyle = goldGradient;
    certCtx.fillText(deathCertificate.finalScore.toString(), centerX, 615);
    
    // Date and time
    const dateStr = deathCertificate.timestamp ? 
        deathCertificate.timestamp.toLocaleDateString('en-US', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        }) : new Date().toLocaleDateString();
    const timeStr = deathCertificate.timestamp ?
        deathCertificate.timestamp.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit'
        }) : '';
    
    certCtx.font = '28px Georgia, serif';
    certCtx.fillStyle = '#888888';
    certCtx.fillText(`${dateStr} at ${timeStr}`, centerX, 700);
    
    // === RIGHT SECTION - Killer Candle/Razor ===
    const rightCenterX = CERT_WIDTH - 300;
    const candleY = 280;
    const candleHeight = 450;
    const candleWidth = 100;
    
    // Candle glow
    const glowGradient = certCtx.createRadialGradient(
        rightCenterX, candleY + candleHeight / 2, 0,
        rightCenterX, candleY + candleHeight / 2, 250
    );
    glowGradient.addColorStop(0, candleColor + '30');
    glowGradient.addColorStop(1, 'transparent');
    certCtx.fillStyle = glowGradient;
    certCtx.fillRect(rightCenterX - 200, candleY - 50, 400, candleHeight + 100);
    
    // Candle wick (top)
    certCtx.fillStyle = '#555555';
    certCtx.fillRect(rightCenterX - 3, candleY, 6, 35);
    
    // Candle body
    const candleGrad = certCtx.createLinearGradient(rightCenterX - candleWidth/2, 0, rightCenterX + candleWidth/2, 0);
    candleGrad.addColorStop(0, candleColor + 'cc');
    candleGrad.addColorStop(0.5, candleColor);
    candleGrad.addColorStop(1, candleColor + '99');
    certCtx.fillStyle = candleGrad;
    certCtx.fillRect(rightCenterX - candleWidth/2, candleY + 35, candleWidth, candleHeight - 70);
    
    // Candle highlight
    certCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    certCtx.fillRect(rightCenterX - candleWidth/2 + 10, candleY + 45, 15, candleHeight - 90);
    
    // Candle wick (bottom)
    certCtx.fillStyle = '#555555';
    certCtx.fillRect(rightCenterX - 3, candleY + candleHeight - 35, 6, 35);
    
    // Draw razor using embedded base64 image
    const razorImg = new Image();
    razorImg.src = CERT_RAZOR_BASE64;
    const razorSize = 140;
    certCtx.save();
    certCtx.translate(rightCenterX, candleY + candleHeight / 2);
    if (candleColor === '#EF5350') {
        certCtx.rotate(Math.PI);
    }
    certCtx.drawImage(
        razorImg,
        -razorSize / 2,
        -razorSize,
        razorSize,
        razorSize * 2
    );
    certCtx.restore();
    
    // === BOTTOM - Branding ===
    certCtx.font = 'bold 64px "Creepster", Georgia, cursive';
    certCtx.fillStyle = '#4a4a4a';
    certCtx.fillText('FLAP EMONAD', centerX, CERT_HEIGHT - 100);
    
    certCtx.font = '24px Georgia, serif';
    certCtx.fillStyle = '#555555';
    certCtx.fillText('emonad.lol  •  Play on Monad', centerX, CERT_HEIGHT - 55);
    
    return certCanvas;
}

function downloadDeathCertificate() {
    // Get player name from input
    const nameInput = document.getElementById('death-cert-name');
    const playerName = nameInput ? nameInput.value.trim() : '';
    
    if (!playerName) {
        nameInput.style.borderColor = '#ff4444';
        nameInput.placeholder = 'Please enter your name!';
        nameInput.focus();
        setTimeout(() => {
            nameInput.style.borderColor = '#8B0000';
            nameInput.placeholder = 'Enter your name for certificate';
        }, 2000);
        return;
    }
    
    const certCanvas = generateDeathCertificate(playerName);
    
    // Convert to data URL and download
    const dataURL = certCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `flap-emonad-death-certificate-${playerName}-${deathCertificate.finalScore}.png`;
    link.href = dataURL;
    link.click();
    
    // Play a sound effect
    if (typeof chiptunePlayer !== 'undefined') {
        chiptunePlayer.playClick();
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
            
            // Spawn score particles
            spawnScoreParticles();
            
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
        return { hit: true, type: 'floor', razor: null };
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
            return { hit: true, type: 'razor-top', razor: razor };
        }
        
        // Check bottom razor collision
        if (playerRight > bottomRazorLeft && 
            playerLeft < bottomRazorRight && 
            playerBottom > bottomRazorTop) {
            return { hit: true, type: 'razor-bottom', razor: razor };
        }
    }
    
    return { hit: false, type: null, razor: null };
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
    // Update screen transition fade
    if (screenTransition.active) {
        screenTransition.elapsed += deltaTime;
        screenTransition.alpha = 1 - (screenTransition.elapsed / screenTransition.duration);
        if (screenTransition.alpha <= 0) {
            screenTransition.alpha = 0;
            screenTransition.active = false;
        }
    }
    
    // Update slow-motion death effect
    let effectiveDeltaTime = deltaTime;
    if (deathSlowMo.active) {
        deathSlowMo.elapsed += deltaTime;
        
        // Ease into slow-mo quickly, then gradually return to normal
        const progress = deathSlowMo.elapsed / deathSlowMo.duration;
        
        if (progress < 0.15) {
            // Quick ramp down to slow-mo (first 15%)
            const rampProgress = progress / 0.15;
            deathSlowMo.timeScale = 1.0 - (1.0 - deathSlowMo.targetScale) * rampProgress;
            deathSlowMo.zoom = 1.0 + (deathSlowMo.targetZoom - 1.0) * rampProgress;
            deathSlowMo.desaturation = rampProgress * 0.6;
        } else if (progress < 0.6) {
            // Hold slow-mo (15% to 60%)
            deathSlowMo.timeScale = deathSlowMo.targetScale;
            deathSlowMo.zoom = deathSlowMo.targetZoom;
            deathSlowMo.desaturation = 0.6;
        } else {
            // Gradually return to normal (60% to 100%)
            const returnProgress = (progress - 0.6) / 0.4;
            deathSlowMo.timeScale = deathSlowMo.targetScale + (1.0 - deathSlowMo.targetScale) * returnProgress;
            deathSlowMo.zoom = deathSlowMo.targetZoom - (deathSlowMo.targetZoom - 1.0) * returnProgress;
            deathSlowMo.desaturation = 0.6 * (1 - returnProgress);
        }
        
        if (progress >= 1.0) {
            deathSlowMo.active = false;
            deathSlowMo.timeScale = 1.0;
            deathSlowMo.zoom = 1.0;
            deathSlowMo.desaturation = 0;
        }
        
        // Apply slow-mo to delta time
        effectiveDeltaTime = deltaTime * deathSlowMo.timeScale;
    }
    
    if (gameState === GameState.PLAYING) {
        updatePlayer(deltaTime);
        updateRazors(deltaTime);
        updateScoreParticles(deltaTime);
        
        // Check collisions
        const collision = checkCollisions();
        if (collision.hit) {
            die(collision.type, collision.razor);
        }
    } else if (gameState === GameState.DYING) {
        updatePlayer(effectiveDeltaTime);
        updateScoreParticles(effectiveDeltaTime);
    }
}

// ============================================
// PARTICLE & EFFECTS SYSTEMS
// ============================================

// Spawn particles when scoring - EPIC burst effect
// ALL RED particles
function spawnScoreParticles() {
    const centerX = GAME_WIDTH / 2;
    const centerY = 140;
    
    // All red color palette
    const redColors = ['#FF4444', '#EF5350', '#FF6B6B', '#E53935', '#D32F2F', '#C62828'];
    
    // RING BURST - expanding ring of particles
    for (let i = 0; i < 24; i++) {
        const angle = (Math.PI * 2 / 24) * i;
        const speed = 18 + Math.random() * 4;
        scoreParticles.push({
            x: centerX,
            y: centerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 5 + Math.random() * 3,
            color: redColors[Math.floor(Math.random() * redColors.length)],
            life: 1.0,
            decay: 0.035,
            type: 'ring',
            initialAngle: angle
        });
    }
    
    // RED COINS - chunky red particles flying out
    for (let i = 0; i < 10; i++) {
        const angle = (Math.PI * 2 / 10) * i + Math.random() * 0.3;
        const speed = 12 + Math.random() * 8;
        scoreParticles.push({
            x: centerX,
            y: centerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 6,
            size: 12 + Math.random() * 8,
            color: redColors[Math.floor(Math.random() * redColors.length)],
            life: 1.0,
            decay: 0.018,
            type: 'coin',
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.4
        });
    }
    
    // SPARKLE EXPLOSION - red sparkles
    for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 8 + Math.random() * 16;
        scoreParticles.push({
            x: centerX + (Math.random() - 0.5) * 30,
            y: centerY + (Math.random() - 0.5) * 30,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 4,
            size: 2 + Math.random() * 4,
            color: redColors[Math.floor(Math.random() * redColors.length)],
            life: 1.0,
            decay: 0.05,
            type: 'sparkle',
            twinkle: Math.random() * Math.PI * 2
        });
    }
    
    // RED BURST - medium red orbs
    for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 / 14) * i + Math.random() * 0.4;
        const speed = 10 + Math.random() * 6;
        const colors = ['#FF4444', '#EF5350', '#E53935'];
        scoreParticles.push({
            x: centerX,
            y: centerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 3,
            size: 10 + Math.random() * 8,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 1.0,
            decay: 0.02,
            type: 'orb'
        });
    }
    
    // CONFETTI - all red squares tumbling
    for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 6 + Math.random() * 10;
        scoreParticles.push({
            x: centerX,
            y: centerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 8,
            size: 8 + Math.random() * 6,
            color: redColors[Math.floor(Math.random() * redColors.length)],
            life: 1.0,
            decay: 0.012,
            type: 'confetti',
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3
        });
    }
    
    // RISING EMBERS - all red slow floaty particles going up
    for (let i = 0; i < 8; i++) {
        const offsetX = (Math.random() - 0.5) * 80;
        scoreParticles.push({
            x: centerX + offsetX,
            y: centerY + Math.random() * 20,
            vx: (Math.random() - 0.5) * 3,
            vy: -10 - Math.random() * 6,
            size: 6 + Math.random() * 6,
            color: redColors[Math.floor(Math.random() * redColors.length)],
            life: 1.0,
            decay: 0.012,
            type: 'ember'
        });
    }
}

// Update score particles - optimized for smooth performance
function updateScoreParticles(deltaTime) {
    const timeScale = deltaTime / TARGET_FRAME_TIME;
    
    // Pre-calculate decay multipliers (avoid repeated Math operations)
    const shrinkFast = Math.pow(0.97, timeScale);
    const shrinkSlow = Math.pow(0.995, timeScale);
    const shrinkNormal = Math.pow(0.985, timeScale);
    const dragRing = Math.pow(0.96, timeScale);
    const dragConfetti = Math.pow(0.99, timeScale);
    const dragEmber = Math.pow(0.97, timeScale);
    
    let i = scoreParticles.length;
    while (i--) {
        const p = scoreParticles[i];
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        
        // Different physics for different particle types
        if (p.type === 'ember') {
            p.vy += 0.08 * timeScale;
            p.vx *= dragEmber;
            p.size *= shrinkNormal;
        } else if (p.type === 'ring') {
            p.vx *= dragRing;
            p.vy *= dragRing;
            p.size *= shrinkFast;
        } else if (p.type === 'confetti') {
            p.vy += 0.5 * timeScale;
            p.vx *= dragConfetti;
            p.rotation += p.rotationSpeed * timeScale;
            p.size *= shrinkSlow;
        } else if (p.type === 'coin') {
            p.vy += 0.4 * timeScale;
            p.rotation += p.rotationSpeed * timeScale;
            p.size *= shrinkNormal;
        } else if (p.type === 'sparkle') {
            p.vy += 0.25 * timeScale;
            p.twinkle += 0.3 * timeScale;
            p.size *= shrinkFast;
        } else {
            p.vy += 0.35 * timeScale;
            p.size *= shrinkNormal;
        }
        
        p.life -= p.decay * timeScale;
        
        if (p.life <= 0 || p.size < 0.3) {
            scoreParticles.splice(i, 1);
        }
    }
}

// Draw score particles - EPIC rendering
function drawScoreParticles() {
    for (const p of scoreParticles) {
        ctx.save();
        ctx.globalAlpha = p.life * p.life; // Quadratic fade
        
        if (p.type === 'ring') {
            // Expanding ring particles - RED
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'coin') {
            // Red coins - spinning ellipses
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            const squish = Math.abs(Math.cos(p.rotation * 2)); // Coin flip effect
            ctx.scale(1, 0.3 + squish * 0.7);
            
            // Coin body - RED
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            ctx.fill();
            
            // Coin shine - lighter red
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#FF8A80';
            ctx.beginPath();
            ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.3, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'sparkle') {
            // Twinkling sparkles - 4-point stars that pulse
            const twinkleSize = p.size * (0.7 + 0.3 * Math.sin(p.twinkle));
            ctx.translate(p.x, p.y);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            
            // Draw 4-point star
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 - Math.PI / 4;
                const outerX = Math.cos(angle) * twinkleSize;
                const outerY = Math.sin(angle) * twinkleSize;
                const innerAngle = angle + Math.PI / 4;
                const innerX = Math.cos(innerAngle) * (twinkleSize * 0.3);
                const innerY = Math.sin(innerAngle) * (twinkleSize * 0.3);
                if (i === 0) ctx.moveTo(outerX, outerY);
                else ctx.lineTo(outerX, outerY);
                ctx.lineTo(innerX, innerY);
            }
            ctx.closePath();
            ctx.fill();
        } else if (p.type === 'orb') {
            // Purple orbs with gradient glow
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.3, p.color);
            gradient.addColorStop(1, p.color + '00');
            ctx.fillStyle = gradient;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.type === 'confetti') {
            // Colorful tumbling rectangles
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 5;
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.type === 'ember') {
            // Glowing embers rising up
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.2, p.color);
            gradient.addColorStop(0.6, p.color + '80');
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 25;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Default circle with glow
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
}

// Update player trail
function updatePlayerTrail() {
    // Add current position to trail
    playerTrail.unshift({
        x: player.x + PLAYER_WIDTH / 2,
        y: player.y + PLAYER_HEIGHT / 2,
        rotation: player.rotation
    });
    
    // Limit trail length
    if (playerTrail.length > MAX_TRAIL_LENGTH) {
        playerTrail.pop();
    }
}

// Draw player trail
function drawPlayerTrail() {
    if (playerTrail.length < 2) return;
    
    for (let i = 1; i < playerTrail.length; i++) {
        const t = playerTrail[i];
        const alpha = (1 - i / playerTrail.length) * 0.3;
        const size = PLAYER_WIDTH * (1 - i / playerTrail.length) * 0.5;
        
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.rotate(t.rotation * Math.PI / 180);
        
        // Draw trail ghost
        ctx.fillStyle = 'rgba(157, 78, 221, 0.5)';
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Initialize clouds
function initClouds() {
    clouds = [];
    for (let i = 0; i < NUM_CLOUDS; i++) {
        clouds.push({
            x: Math.random() * GAME_WIDTH,
            y: 100 + Math.random() * (GAME_HEIGHT - 300),
            width: 200 + Math.random() * 300,
            height: 80 + Math.random() * 120,
            speed: 0.3 + Math.random() * 0.4,
            opacity: 0.03 + Math.random() * 0.04
        });
    }
}

// Update clouds
function updateClouds(deltaTime) {
    const timeScale = deltaTime / TARGET_FRAME_TIME;
    
    for (const cloud of clouds) {
        cloud.x -= cloud.speed * timeScale;
        
        // Wrap around
        if (cloud.x + cloud.width < 0) {
            cloud.x = GAME_WIDTH + 50;
            cloud.y = 100 + Math.random() * (GAME_HEIGHT - 300);
        }
    }
}

// Draw clouds (subtle, blurred dark clouds)
function drawClouds() {
    ctx.save();
    
    for (const cloud of clouds) {
        ctx.globalAlpha = cloud.opacity;
        
        // Draw blurred dark cloud shape
        const gradient = ctx.createRadialGradient(
            cloud.x + cloud.width / 2, cloud.y + cloud.height / 2, 0,
            cloud.x + cloud.width / 2, cloud.y + cloud.height / 2, cloud.width / 2
        );
        gradient.addColorStop(0, 'rgba(30, 20, 50, 0.8)');
        gradient.addColorStop(0.5, 'rgba(30, 20, 50, 0.4)');
        gradient.addColorStop(1, 'rgba(30, 20, 50, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(
            cloud.x + cloud.width / 2,
            cloud.y + cloud.height / 2,
            cloud.width / 2,
            cloud.height / 2,
            0, 0, Math.PI * 2
        );
        ctx.fill();
    }
    
    ctx.restore();
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
// Pre-cached razor dimensions (calculated once on first use)
let _cachedRazorHeight = 0;

function drawRazors() {
    // Trading candle colors
    const RED_CANDLE = '#EF5350';   // Red for top (bearish)
    const GREEN_CANDLE = '#26A69A'; // Green for bottom (bullish)
    
    // Calculate razor height once
    if (_cachedRazorHeight === 0 && images.razor && images.razor.width > 0) {
        _cachedRazorHeight = RAZOR_WIDTH * (images.razor.height / images.razor.width);
    }
    const singleRazorHeight = _cachedRazorHeight || RAZOR_WIDTH;
    
    for (const razor of razors) {
        
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
        ctx.font = 'bold 130px "Creepster", cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const scoreText = score.toString();
        const x = GAME_WIDTH / 2;
        const y = 75;
        
        // Animated glow pulse
        const glowPulse = 0.7 + 0.3 * Math.sin(Date.now() / 400);
        const glowSize = 25 + glowPulse * 15;
        
        // Multiple glow layers for neon effect
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Outer purple glow
        ctx.shadowColor = 'rgba(157, 78, 221, 0.6)';
        ctx.shadowBlur = glowSize + 20;
        ctx.fillStyle = 'rgba(157, 78, 221, 0.3)';
        ctx.fillText(scoreText, x, y);
        
        // Mid glow
        ctx.shadowColor = 'rgba(157, 78, 221, 0.8)';
        ctx.shadowBlur = glowSize;
        ctx.fillStyle = 'rgba(200, 150, 255, 0.5)';
        ctx.fillText(scoreText, x, y);
        
        // Inner white glow
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(scoreText, x, y);
        
        // Black stroke for definition
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 5;
        ctx.strokeText(scoreText, x, y);
        
        ctx.restore();
    }
}

function drawStartScreen(deltaTime) {
    // Draw lighter dark background with gradient (25% lighter than loading screen)
    const bgGradient = ctx.createRadialGradient(
        GAME_WIDTH / 2, GAME_HEIGHT / 2, 0,
        GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT
    );
    bgGradient.addColorStop(0, '#2d1a4a');  // 25% lighter
    bgGradient.addColorStop(0.5, '#1a0d2a'); // 25% lighter
    bgGradient.addColorStop(1, '#0f0812');  // 25% lighter
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    
    // Draw background particles
    drawStartScreenParticles();
    
    // Update animation timer
    startScreenAnimTimer += deltaTime;
    
    // Update flap animation (150ms per frame for smooth loop)
    if (startScreenAnimTimer >= 150) {
        startScreenAnimTimer = 0;
        startScreenFlapFrame = (startScreenFlapFrame + 1) % 3;
        startScreenDieFrame = (startScreenDieFrame + 1) % 3;
    }
    
    // Draw title with glow
    ctx.save();
    ctx.font = 'bold 108px "Creepster", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Glow effect
    ctx.shadowColor = 'rgba(157, 78, 221, 0.6)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#e0aaff';
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
        const bob = Math.sin(Date.now() / 300) * 8;
        // Add glow to character
        ctx.shadowColor = 'rgba(157, 78, 221, 0.5)';
        ctx.shadowBlur = 25;
        ctx.drawImage(
            flapSprite,
            -170,
            -170 + bob,
            340,
            340
        );
        ctx.restore();
    }
    
    // Draw "Tap to Start" text in middle
    ctx.save();
    ctx.font = '52px "Creepster", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Pulsing opacity
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#e0aaff';
    ctx.shadowColor = 'rgba(157, 78, 221, 0.5)';
    ctx.shadowBlur = 10;
    ctx.fillText('TAP TO START', GAME_WIDTH / 2, GAME_HEIGHT / 2);
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
    
    // Draw TOP 3 LEADERBOARD preview
    if (topScores.length > 0) {
        ctx.save();
        const lbPreviewY = GAME_HEIGHT * 0.78;
        
        // Title
        ctx.font = 'bold 32px "Creepster", cursive';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.fillText('🏆 TOP SCORES 🏆', GAME_WIDTH / 2, lbPreviewY);
        
        // Scores
        ctx.font = '28px "Creepster", cursive';
        ctx.shadowBlur = 5;
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < topScores.length && i < 3; i++) {
            const yPos = lbPreviewY + 40 + (i * 35);
            const name = topScores[i].name.length > 12 ? topScores[i].name.substring(0, 12) + '...' : topScores[i].name;
            ctx.fillStyle = i === 0 ? '#FFD700' : (i === 1 ? '#C0C0C0' : '#CD7F32');
            ctx.fillText(`${medals[i]} ${name}: ${topScores[i].score}`, GAME_WIDTH / 2, yPos);
        }
        ctx.restore();
    }
    
    // Draw "View Leaderboard" button with premium effects
    ctx.save();
    const lbBtnY = GAME_HEIGHT * 0.92;
    const lbBtnWidth = 420;
    const lbBtnHeight = 70;
    const lbBtnX = GAME_WIDTH / 2 - lbBtnWidth / 2;
    
    // Animated glow pulse
    const glowPulse = 0.5 + 0.5 * Math.sin(Date.now() / 500);
    const glowIntensity = 15 + glowPulse * 15;
    
    // Outer glow
    ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
    ctx.shadowBlur = glowIntensity;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    
    // Button background with animated gradient
    const gradientOffset = (Date.now() / 20) % lbBtnWidth;
    const gradient = ctx.createLinearGradient(lbBtnX - gradientOffset, lbBtnY, lbBtnX + lbBtnWidth + gradientOffset, lbBtnY);
    gradient.addColorStop(0, '#FFD700');
    gradient.addColorStop(0.3, '#FFC107');
    gradient.addColorStop(0.5, '#FFEB3B');
    gradient.addColorStop(0.7, '#FFC107');
    gradient.addColorStop(1, '#FFD700');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(lbBtnX, lbBtnY, lbBtnWidth, lbBtnHeight, 18);
    ctx.fill();
    
    // Inner highlight (top edge)
    ctx.shadowBlur = 0;
    const highlightGrad = ctx.createLinearGradient(lbBtnX, lbBtnY, lbBtnX, lbBtnY + 20);
    highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlightGrad;
    ctx.beginPath();
    ctx.roundRect(lbBtnX + 3, lbBtnY + 3, lbBtnWidth - 6, 25, [15, 15, 0, 0]);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(lbBtnX, lbBtnY, lbBtnWidth, lbBtnHeight, 18);
    ctx.stroke();
    
    // Button text with shadow
    ctx.font = 'bold 40px "Creepster", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Text shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText('🏆 VIEW LEADERBOARD', GAME_WIDTH / 2 + 2, lbBtnY + lbBtnHeight / 2 + 2);
    
    // Main text
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('🏆 VIEW LEADERBOARD', GAME_WIDTH / 2, lbBtnY + lbBtnHeight / 2);
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
    // Update screen shake
    let shakeX = 0, shakeY = 0;
    if (screenShake.active) {
        screenShake.elapsed += deltaTime;
        if (screenShake.elapsed >= screenShake.duration) {
            screenShake.active = false;
        } else {
            // Decay intensity over time with easing
            const progress = screenShake.elapsed / screenShake.duration;
            const decay = 1 - (progress * progress);  // Quadratic ease out
            const currentIntensity = screenShake.intensity * decay;
            
            // Random shake offset with some directional bias
            shakeX = (Math.random() - 0.5) * 2 * currentIntensity;
            shakeY = (Math.random() - 0.5) * 2 * currentIntensity;
            
            // Add some rotational shake feel by biasing direction
            const angle = Math.random() * Math.PI * 2;
            shakeX += Math.cos(angle) * currentIntensity * 0.3;
            shakeY += Math.sin(angle) * currentIntensity * 0.3;
        }
    }
    
    // Apply screen shake transform
    ctx.save();
    ctx.translate(shakeX, shakeY);
    
    // Draw background based on state
    if (gameState === GameState.READY) {
        // Dark purple gradient for start screen
        const bgGradient = ctx.createRadialGradient(
            GAME_WIDTH / 2, GAME_HEIGHT / 2, 0,
            GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT
        );
        bgGradient.addColorStop(0, '#2d1a4a');
        bgGradient.addColorStop(0.5, '#1a0d2a');
        bgGradient.addColorStop(1, '#0f0812');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(-50, -50, GAME_WIDTH + 100, GAME_HEIGHT + 100);
        
        drawStartScreen(deltaTime);
    } else {
        // Apply zoom effect during death slow-mo
        if (deathSlowMo.active && deathSlowMo.zoom !== 1.0) {
            ctx.save();
            const zoomCenterX = player.x + PLAYER_WIDTH / 2;
            const zoomCenterY = player.y + PLAYER_HEIGHT / 2;
            ctx.translate(zoomCenterX, zoomCenterY);
            ctx.scale(deathSlowMo.zoom, deathSlowMo.zoom);
            ctx.translate(-zoomCenterX, -zoomCenterY);
        }
        
        // White background for gameplay
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-50, -50, GAME_WIDTH + 100, GAME_HEIGHT + 100);
        
        drawRazors();
        drawPlayer();
        drawScore();
        
        // Draw score particles (on top)
        drawScoreParticles();
        
        // Apply desaturation overlay during death
        if (deathSlowMo.active && deathSlowMo.desaturation > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'saturation';
            ctx.fillStyle = `rgba(128, 128, 128, ${deathSlowMo.desaturation})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.restore();
            
            // Add dramatic vignette
            ctx.save();
            const vignetteGradient = ctx.createRadialGradient(
                GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.3,
                GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.8
            );
            vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            vignetteGradient.addColorStop(1, `rgba(0, 0, 0, ${deathSlowMo.desaturation * 0.5})`);
            ctx.fillStyle = vignetteGradient;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.restore();
        }
        
        if (deathSlowMo.active && deathSlowMo.zoom !== 1.0) {
            ctx.restore();
        }
        
        // Draw fade overlay during transition
        if (screenTransition.active) {
            ctx.save();
            ctx.fillStyle = `rgba(45, 26, 74, ${screenTransition.alpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.restore();
        }
    }
    
    ctx.restore();
    
    // Draw screen flash overlay (after restore so it's not shaken)
    if (screenFlash.active) {
        screenFlash.elapsed += deltaTime;
        
        let alpha = 0;
        const flashInTime = 50;   // Quick flash in
        const holdTime = 80;      // Brief hold
        const fadeOutTime = screenFlash.duration - flashInTime - holdTime;
        
        if (screenFlash.elapsed < flashInTime) {
            // Flash in - quick burst
            alpha = (screenFlash.elapsed / flashInTime) * 0.8;
        } else if (screenFlash.elapsed < flashInTime + holdTime) {
            // Hold at peak
            alpha = 0.8;
        } else if (screenFlash.elapsed < screenFlash.duration) {
            // Fade out
            const fadeProgress = (screenFlash.elapsed - flashInTime - holdTime) / fadeOutTime;
            alpha = 0.8 * (1 - fadeProgress);
        } else {
            screenFlash.active = false;
        }
        
        if (alpha > 0) {
            ctx.save();
            ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            
            // Add a white flash burst at the very start for extra impact
            if (screenFlash.elapsed < 30) {
                const whiteAlpha = (1 - screenFlash.elapsed / 30) * 0.5;
                ctx.fillStyle = `rgba(255, 255, 255, ${whiteAlpha})`;
                ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            }
            ctx.restore();
        }
    }
}

// ============================================
// GAME LOOP
// ============================================

// Smoothing for delta time to prevent micro-jitter
let smoothedDeltaTime = TARGET_FRAME_TIME;
const DELTA_SMOOTHING = 0.85; // Balanced smoothing

// Frame time history for better smoothing
let frameTimeHistory = [];
const FRAME_HISTORY_SIZE = 5;

function gameLoop(currentTime) {
    // Calculate raw delta time
    let rawDeltaTime = currentTime - lastTime;
    lastTime = currentTime;
    
    // Cap delta time to prevent physics explosions after tab switch/PWA resume
    if (rawDeltaTime > 100) rawDeltaTime = TARGET_FRAME_TIME;
    if (rawDeltaTime < 1) rawDeltaTime = TARGET_FRAME_TIME;
    
    // Add to frame history
    frameTimeHistory.push(rawDeltaTime);
    if (frameTimeHistory.length > FRAME_HISTORY_SIZE) {
        frameTimeHistory.shift();
    }
    
    // Use median of recent frames to filter outliers
    const sortedHistory = [...frameTimeHistory].sort((a, b) => a - b);
    const medianDelta = sortedHistory[Math.floor(sortedHistory.length / 2)];
    
    // Smooth using exponential moving average on median
    smoothedDeltaTime = smoothedDeltaTime * DELTA_SMOOTHING + medianDelta * (1 - DELTA_SMOOTHING);
    
    // Clamp to reasonable range
    smoothedDeltaTime = Math.max(8, Math.min(smoothedDeltaTime, 32));
    
    // Update and render with smoothed delta
    update(smoothedDeltaTime);
    render(smoothedDeltaTime);
    
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

// Called when user clicks PLAY button or auto-advances
function startGameFromLoading() {
    // Prevent double-tap issues
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
        playBtn.disabled = true;
        playBtn.style.pointerEvents = 'none';
    }
    
    // ALWAYS dismiss loading screen first - don't wait for audio
    dismissLoadingScreen();
    
    // Try to initialize audio (will fail silently on auto-advance, that's OK)
    try {
        if (typeof chiptunePlayer !== 'undefined') {
            chiptunePlayer.init();
            
            // Try to resume audio context (may fail without user gesture)
            if (chiptunePlayer.audioContext && chiptunePlayer.audioContext.state === 'suspended') {
                chiptunePlayer.audioContext.resume().catch(() => {
                    // Audio failed, that's fine - game still works
                });
            }
        }
    } catch (e) {
        // Audio init failed, that's fine
        console.log('Audio init skipped (no user gesture)');
    }
}

// Setup play button and loading screen tap handling for PWA
function setupPlayButton() {
    const playBtn = document.getElementById('play-btn');
    const loadingScreen = document.getElementById('loading-screen');
    
    let gameStarted = false;
    
    // Function to start game (only once)
    function tryStartGame() {
        if (gameStarted || !gameReady) return;
        gameStarted = true;
        startGameFromLoading();
    }
    
    // Play button handlers
    if (playBtn) {
        playBtn.addEventListener('touchend', function(e) {
            e.preventDefault();
            e.stopPropagation();
            tryStartGame();
        }, { passive: false });
        
        playBtn.addEventListener('click', function(e) {
            tryStartGame();
        });
    }
    
    // TAP ANYWHERE on loading screen to start (for PWA/popup browsers)
    if (loadingScreen) {
        loadingScreen.addEventListener('touchend', function(e) {
            if (gameReady && !gameStarted) {
                e.preventDefault();
                tryStartGame();
            }
        }, { passive: false });
        
        loadingScreen.addEventListener('click', function(e) {
            if (gameReady && !gameStarted) {
                tryStartGame();
            }
        });
    }
    
    // AUTO-ADVANCE on mobile after 2 seconds (for popup browsers that don't register taps)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.matchMedia && window.matchMedia('(hover: none)').matches);
    if (isMobile) {
        setTimeout(() => {
            if (!gameStarted && gameReady) {
                console.log('Auto-advancing from loading screen (mobile fallback)');
                tryStartGame();
            }
        }, 2000);
    }
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
        
        // Fetch top 3 leaderboard scores for start screen
        fetchTopScores();
        
        // DON'T initialize audio here - must be done on user tap for mobile!
        // Audio will be initialized in startGameFromLoading() when user taps PLAY
        
        updateLoadingBar(80);
        
        // Start game loop
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
        
        updateLoadingBar(100);
        
        console.log('Game ready!');
        
        // Setup play button with iOS PWA touch handling
        setupPlayButton();
        
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

// Fetch top 3 scores from leaderboard contract
async function fetchTopScores() {
    try {
        const provider = new ethers.JsonRpcProvider(MONAD_RPC);
        const contract = new ethers.Contract(LEADERBOARD_ADDRESS, LEADERBOARD_ABI, provider);
        const [addresses, names, scores] = await contract.getTopScores(3);
        
        topScores = [];
        for (let i = 0; i < addresses.length && i < 3; i++) {
            if (scores[i] > 0) {
                topScores.push({
                    name: names[i] || 'Anonymous',
                    score: Number(scores[i])
                });
            }
        }
        console.log('Top scores loaded:', topScores);
    } catch (error) {
        console.log('Could not fetch leaderboard:', error.message);
        topScores = [];
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


// Handle visibility change (iOS PWA backgrounding)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // App backgrounded - pause music
        if (typeof chiptunePlayer !== 'undefined' && chiptunePlayer.audioContext) {
            chiptunePlayer.audioContext.suspend();
        }
    } else {
        // App resumed - reset lastTime to prevent physics jump
        lastTime = performance.now();
        
        // Resume audio context
        if (typeof chiptunePlayer !== 'undefined' && chiptunePlayer.audioContext) {
            chiptunePlayer.audioContext.resume();
        }
    }
});

// Handle page show (iOS PWA cold start / bfcache)
window.addEventListener('pageshow', function(event) {
    // Reset timing on page show (handles bfcache restoration)
    lastTime = performance.now();
    
    // Re-setup play button in case it wasn't set up
    if (!gameReady) {
        setupPlayButton();
    }
});

// Start the game
init();

// Load leaderboard on page load
setTimeout(loadLeaderboard, 1000);
