/**
 * Flap Emonad - Chiptune Audio System v2
 * Clean rewrite - Metal/Emo style at 110 BPM
 * No overlapping, smooth transitions
 */

class ChiptunePlayer {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.isPlaying = false;
        this.currentTrack = null;
        this.loopTimeout = null;
        this.isMuted = false;
    }

    init() {
        if (this.audioContext) return;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.4;
        this.masterGain.connect(this.audioContext.destination);
        
        this.musicGain = this.audioContext.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(this.masterGain);
        
        this.sfxGain = this.audioContext.createGain();
        this.sfxGain.gain.value = 0.7;
        this.sfxGain.connect(this.masterGain);
        
        this.loadVolumeSettings();
        this.unlockAudio();
    }
    
    loadVolumeSettings() {
        try {
            const saved = localStorage.getItem('flapEmonadSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.musicVolume !== undefined) this.setMusicVolume(settings.musicVolume);
                if (settings.sfxVolume !== undefined) this.setSfxVolume(settings.sfxVolume);
                if (settings.muted) {
                    this.isMuted = true;
                    if (this.masterGain) this.masterGain.gain.value = 0;
                }
            }
        } catch (e) {}
    }
    
    setMusicVolume(v) { if (this.musicGain) this.musicGain.gain.value = Math.max(0, Math.min(1, v)); }
    setSfxVolume(v) { if (this.sfxGain) this.sfxGain.gain.value = Math.max(0, Math.min(1, v)); }
    getMusicVolume() { return this.musicGain ? this.musicGain.gain.value : 0.5; }
    getSfxVolume() { return this.sfxGain ? this.sfxGain.gain.value : 0.7; }
    
    unlockAudio() {
        if (!this.audioContext) return;
        const buffer = this.audioContext.createBuffer(1, 1, 22050);
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start(0);
    }
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 0.4;
        }
        try {
            const saved = localStorage.getItem('flapEmonadSettings');
            const settings = saved ? JSON.parse(saved) : {};
            settings.muted = this.isMuted;
            localStorage.setItem('flapEmonadSettings', JSON.stringify(settings));
        } catch (e) {}
        return this.isMuted;
    }

    // ========== CORE NOTE PLAYING ==========
    
    note(name, octave = 4) {
        const notes = {
            'C': 261.63, 'C#': 277.18, 'Db': 277.18, 'D': 293.66, 'D#': 311.13, 'Eb': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'Gb': 369.99, 'G': 392.00,
            'G#': 415.30, 'Ab': 415.30, 'A': 440.00, 'A#': 466.16, 'Bb': 466.16, 'B': 493.88
        };
        return (notes[name] || 440) * Math.pow(2, octave - 4);
    }

    // Clean square lead
    playLead(freq, startTime, duration, volume = 0.2) {
        if (!this.audioContext) return;
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(this.musicGain);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
        gain.gain.setValueAtTime(volume * 0.8, startTime + duration * 0.7);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
    }

    // Heavy bass
    playBass(freq, startTime, duration, volume = 0.4) {
        if (!this.audioContext) return;
        
        // Sub layer
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = freq;
        osc1.connect(gain1);
        gain1.connect(this.musicGain);
        
        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        gain1.gain.setValueAtTime(volume * 0.9, startTime + duration * 0.8);
        gain1.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc1.start(startTime);
        osc1.stop(startTime + duration + 0.01);
        
        // Punch layer
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = freq * 2;
        osc2.connect(gain2);
        gain2.connect(this.musicGain);
        
        gain2.gain.setValueAtTime(volume * 0.3, startTime);
        gain2.gain.linearRampToValueAtTime(0, startTime + duration * 0.3);
        
        osc2.start(startTime);
        osc2.stop(startTime + duration + 0.01);
    }

    // Arpeggio note
    playArp(freq, startTime, duration, volume = 0.12) {
        if (!this.audioContext) return;
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(this.musicGain);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
    }

    // ========== TRACK 1: "NEON FUNERAL" - Metal/Emo at 110 BPM ==========
    // Think: My Chemical Romance meets 8-bit
    // A minor - emotional but driving
    playTrack1() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 110;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // A minor progression: Am - F - C - G (classic emo)
        // 16 bars total = 64 beats
        
        // MELODY - Emotional but catchy
        const melody = [
            // Bar 1-4: Intro hook
            ['A', 5, 2], ['C', 6, 2], ['B', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['A', 5, 2], ['E', 5, 4],
            ['A', 5, 2], ['C', 6, 2], ['B', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['E', 5, 2], ['A', 5, 4],
            // Bar 5-8: Build
            ['C', 6, 2], ['D', 6, 2], ['E', 6, 4],
            ['D', 6, 2], ['C', 6, 2], ['B', 5, 4],
            ['A', 5, 2], ['B', 5, 2], ['C', 6, 2], ['B', 5, 2],
            ['A', 5, 4], ['G', 5, 4],
            // Bar 9-12: Chorus
            ['E', 6, 2], ['D', 6, 2], ['C', 6, 4],
            ['D', 6, 2], ['E', 6, 2], ['D', 6, 4],
            ['C', 6, 2], ['B', 5, 2], ['A', 5, 4],
            ['B', 5, 2], ['C', 6, 2], ['A', 5, 4],
            // Bar 13-16: Outro
            ['A', 5, 2], ['C', 6, 2], ['B', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['A', 5, 2], ['E', 5, 4],
            ['A', 5, 2], ['G', 5, 2], ['E', 5, 4],
            ['A', 5, 8]
        ];
        
        // BASS - Driving power chords feel
        const bass = [
            // Am - F - C - G pattern, 2 bars each
            ['A', 2, 4], ['A', 2, 4], ['F', 2, 4], ['F', 2, 4],
            ['C', 2, 4], ['C', 2, 4], ['G', 2, 4], ['G', 2, 4],
            ['A', 2, 4], ['A', 2, 4], ['F', 2, 4], ['F', 2, 4],
            ['C', 2, 4], ['C', 2, 4], ['G', 2, 4], ['G', 2, 4]
        ];
        
        // ARPEGGIOS - 16th note patterns
        const arpPattern = ['A', 'E', 'A', 'C', 'E', 'A', 'C', 'E'];
        
        // Schedule melody
        let time = 0;
        for (const [note, oct, beats] of melody) {
            this.playLead(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.9, 0.18);
            time += beats;
        }
        
        // Schedule bass
        time = 0;
        for (const [note, oct, beats] of bass) {
            this.playBass(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.95, 0.35);
            time += beats;
        }
        
        // Schedule arpeggios (8 per bar, 16 bars)
        const arpBeatTime = beatTime / 2; // 8th notes
        for (let bar = 0; bar < 16; bar++) {
            for (let i = 0; i < 8; i++) {
                const noteIdx = i % arpPattern.length;
                const octave = (i % 2 === 0) ? 4 : 5;
                this.playArp(this.note(arpPattern[noteIdx], octave), now + (bar * 8 + i) * arpBeatTime, arpBeatTime * 0.7, 0.08);
            }
        }
        
        // Loop after 64 beats
        const loopTime = 64 * beatTime * 1000;
        this.loopTimeout = setTimeout(() => {
            if (this.isPlaying) this.playTrack1();
        }, loopTime - 100);
    }

    // ========== TRACK 2: "DIGITAL HEARTBREAK" - Slower emo ballad 95 BPM ==========
    playTrack2() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 95;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // E minor - sadder, more emotional
        const melody = [
            // Verse - slow and emotional
            ['E', 5, 4], ['G', 5, 4], ['F#', 5, 4], ['E', 5, 4],
            ['D', 5, 4], ['E', 5, 4], ['B', 4, 8],
            ['E', 5, 4], ['G', 5, 4], ['A', 5, 4], ['G', 5, 4],
            ['F#', 5, 4], ['E', 5, 4], ['E', 5, 8],
            // Chorus - builds up
            ['B', 5, 4], ['A', 5, 4], ['G', 5, 8],
            ['A', 5, 4], ['B', 5, 4], ['A', 5, 8],
            ['G', 5, 4], ['F#', 5, 4], ['E', 5, 8],
            ['F#', 5, 4], ['G', 5, 4], ['E', 5, 8]
        ];
        
        const bass = [
            ['E', 2, 8], ['C', 2, 8], ['D', 2, 8], ['B', 1, 8],
            ['E', 2, 8], ['C', 2, 8], ['D', 2, 8], ['B', 1, 8]
        ];
        
        const arpPattern = ['E', 'B', 'E', 'G', 'B', 'E', 'G', 'B'];
        
        let time = 0;
        for (const [note, oct, beats] of melody) {
            this.playLead(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.85, 0.15);
            time += beats;
        }
        
        time = 0;
        for (const [note, oct, beats] of bass) {
            this.playBass(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.9, 0.3);
            time += beats;
        }
        
        const arpBeatTime = beatTime / 2;
        for (let bar = 0; bar < 16; bar++) {
            for (let i = 0; i < 8; i++) {
                const noteIdx = i % arpPattern.length;
                const octave = (i % 2 === 0) ? 4 : 5;
                this.playArp(this.note(arpPattern[noteIdx], octave), now + (bar * 8 + i) * arpBeatTime, arpBeatTime * 0.6, 0.06);
            }
        }
        
        const loopTime = 64 * beatTime * 1000;
        this.loopTimeout = setTimeout(() => {
            if (this.isPlaying) this.playTrack2();
        }, loopTime - 100);
    }

    // ========== TRACK 3: "BROKEN STATIC" - Faster punk/metal 125 BPM ==========
    playTrack3() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 125;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // D minor - aggressive, punk energy
        const melody = [
            // Fast aggressive riffs
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['F', 5, 2], ['E', 5, 2], ['D', 5, 2],
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['Bb', 5, 2], ['A', 5, 2], ['G', 5, 2], ['D', 5, 2],
            // Build
            ['A', 5, 2], ['Bb', 5, 2], ['C', 6, 4],
            ['Bb', 5, 2], ['A', 5, 2], ['G', 5, 4],
            ['F', 5, 2], ['G', 5, 2], ['A', 5, 4],
            ['G', 5, 2], ['F', 5, 2], ['D', 5, 4],
            // Climax
            ['D', 6, 2], ['C', 6, 2], ['Bb', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['F', 5, 2], ['E', 5, 2], ['D', 5, 2],
            ['D', 6, 2], ['C', 6, 2], ['Bb', 5, 2], ['A', 5, 2],
            ['D', 5, 8]
        ];
        
        const bass = [
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['C', 2, 4], ['C', 2, 4],
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['D', 2, 8]
        ];
        
        const arpPattern = ['D', 'A', 'D', 'F', 'A', 'D', 'F', 'A'];
        
        let time = 0;
        for (const [note, oct, beats] of melody) {
            this.playLead(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.85, 0.2);
            time += beats;
        }
        
        time = 0;
        for (const [note, oct, beats] of bass) {
            this.playBass(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.9, 0.38);
            time += beats;
        }
        
        const arpBeatTime = beatTime / 2;
        for (let bar = 0; bar < 14; bar++) {
            for (let i = 0; i < 8; i++) {
                const noteIdx = i % arpPattern.length;
                const octave = (i % 2 === 0) ? 4 : 5;
                this.playArp(this.note(arpPattern[noteIdx], octave), now + (bar * 8 + i) * arpBeatTime, arpBeatTime * 0.6, 0.1);
            }
        }
        
        const loopTime = 56 * beatTime * 1000;
        this.loopTimeout = setTimeout(() => {
            if (this.isPlaying) this.playTrack3();
        }, loopTime - 100);
    }

    // ========== GAME OVER TRACK - Slow sad ==========
    playGameOverTrack() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 60;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // A minor - sad and reflective
        const melody = [
            ['E', 5, 4], ['D', 5, 4], ['C', 5, 8],
            ['D', 5, 4], ['E', 5, 4], ['A', 4, 8],
            ['E', 5, 4], ['D', 5, 4], ['C', 5, 4], ['B', 4, 4],
            ['A', 4, 16]
        ];
        
        const bass = [
            ['A', 2, 8], ['F', 2, 8], ['C', 2, 8], ['A', 2, 8]
        ];
        
        let time = 0;
        for (const [note, oct, beats] of melody) {
            this.playLead(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.8, 0.12);
            time += beats;
        }
        
        time = 0;
        for (const [note, oct, beats] of bass) {
            this.playBass(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.85, 0.25);
            time += beats;
        }
        
        const loopTime = 32 * beatTime * 1000;
        this.loopTimeout = setTimeout(() => {
            if (this.isPlaying) this.playGameOverTrack();
        }, loopTime - 100);
    }

    // ========== PLAYBACK CONTROL ==========
    
    stop() {
        this.isPlaying = false;
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
        }
    }

    playTrack(trackNum) {
        this.init();
        this.stop();
        this.isPlaying = true;
        
        switch(trackNum) {
            case 1: this.playTrack1(); break;
            case 2: this.playTrack2(); break;
            case 3: this.playTrack3(); break;
            default: this.playTrack1();
        }
    }

    playMenuMusic() {
        // Get track preference from settings
        let trackNum = 1;
        try {
            const saved = localStorage.getItem('flapEmonadSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.musicTrack === 'random') {
                    trackNum = Math.floor(Math.random() * 3) + 1;
                } else if (settings.musicTrack) {
                    trackNum = parseInt(settings.musicTrack) || 1;
                }
            }
        } catch (e) {}
        
        this.playTrack(trackNum);
    }

    playGameOverMusic() {
        this.init();
        this.stop();
        this.isPlaying = true;
        this.playGameOverTrack();
    }

    playLeaderboardMusic() {
        this.playTrack(2); // Use the slower emotional track
    }

    // ========== SOUND EFFECTS ==========
    
    playFlap() {
        this.init();
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.04);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.1);
    }

    playScore() {
        this.init();
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1100, now + 0.05);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    playDeath() {
        this.init();
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        
        // Descending crash
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.4);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.6);
    }

    playHighScore() {
        this.init();
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        
        // Victory fanfare
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.15, now + i * 0.15);
            gain.gain.linearRampToValueAtTime(0, now + i * 0.15 + 0.2);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start(now + i * 0.15);
            osc.stop(now + i * 0.15 + 0.25);
        });
    }

    playClick() {
        this.init();
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'square';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.05);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.06);
    }
}

// Global instance
const chiptunePlayer = new ChiptunePlayer();
