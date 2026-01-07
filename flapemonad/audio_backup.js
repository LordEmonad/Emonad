/**
 * Flap Emonad - Chiptune Audio System
 * Emo-style 8-bit music and sound effects using Web Audio API
 */

class ChiptunePlayer {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.isPlaying = false;
        this.currentTrack = null;
        this.tempo = 120;
        this.stepTime = 60 / this.tempo / 4; // 16th notes
        this.stepIndex = 0;
        this.scheduledNotes = [];
        this.loopInterval = null;
        this.activeOscillators = []; // Track all active oscillators for clean stop
    }

    init() {
        if (this.audioContext) return;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Master gain
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.audioContext.destination);
        
        // Separate gains for music and SFX
        this.musicGain = this.audioContext.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(this.masterGain);
        
        this.sfxGain = this.audioContext.createGain();
        this.sfxGain.gain.value = 0.7;
        this.sfxGain.connect(this.masterGain);
        
        // Load saved volume settings
        this.loadVolumeSettings();
        
        // Unlock audio for iOS Safari - play a silent buffer
        this.unlockAudio();
    }
    
    // Load volume settings from localStorage
    loadVolumeSettings() {
        try {
            const saved = localStorage.getItem('flapEmonadSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.musicVolume !== undefined) {
                    this.setMusicVolume(settings.musicVolume);
                }
                if (settings.sfxVolume !== undefined) {
                    this.setSfxVolume(settings.sfxVolume);
                }
                if (settings.muted) {
                    this.isMuted = true;
                    if (this.masterGain) this.masterGain.gain.value = 0;
                }
            }
        } catch (e) {
            console.log('Could not load audio settings');
        }
    }
    
    // Set music volume (0-1)
    setMusicVolume(volume) {
        if (this.musicGain) {
            this.musicGain.gain.value = Math.max(0, Math.min(1, volume));
        }
    }
    
    // Set SFX volume (0-1)
    setSfxVolume(volume) {
        if (this.sfxGain) {
            this.sfxGain.gain.value = Math.max(0, Math.min(1, volume));
        }
    }
    
    // Get current volumes
    getMusicVolume() {
        return this.musicGain ? this.musicGain.gain.value : 0.5;
    }
    
    getSfxVolume() {
        return this.sfxGain ? this.sfxGain.gain.value : 0.7;
    }
    
    // Unlock audio context for iOS Safari
    unlockAudio() {
        if (!this.audioContext) return;
        
        // Create and play a silent buffer to unlock
        const buffer = this.audioContext.createBuffer(1, 1, 22050);
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start(0);
        
        // Also resume if suspended
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    // Create oscillator with envelope
    createNote(freq, duration, type = 'square', gainNode = this.musicGain) {
        const osc = this.audioContext.createOscillator();
        const noteGain = this.audioContext.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        
        osc.connect(noteGain);
        noteGain.connect(gainNode);
        
        return { osc, noteGain, duration };
    }

    playNote(freq, startTime, duration, type = 'square', gainNode = this.musicGain, volume = 0.3, trackOsc = true) {
        if (!this.audioContext) return;
        
        const osc = this.audioContext.createOscillator();
        const noteGain = this.audioContext.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        
        osc.connect(noteGain);
        noteGain.connect(gainNode);
        
        // Envelope
        noteGain.gain.setValueAtTime(0, startTime);
        noteGain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        noteGain.gain.linearRampToValueAtTime(volume * 0.7, startTime + duration * 0.3);
        noteGain.gain.linearRampToValueAtTime(0, startTime + duration);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
        
        // Track oscillator for clean stop (only for music, not SFX)
        if (trackOsc && gainNode === this.musicGain) {
            this.activeOscillators.push({ osc, noteGain, endTime: startTime + duration });
        }
    }
    
    // EPIC thick lead with detuned oscillators for that AAA sound
    playThickNote(freq, startTime, duration, gainNode = this.musicGain, volume = 0.25) {
        if (!this.audioContext) return;
        
        // Create multiple detuned oscillators for thickness
        const detunes = [-12, -5, 0, 5, 12]; // Slight detune for chorus effect
        const types = ['sawtooth', 'square', 'sawtooth'];
        
        for (let i = 0; i < 3; i++) {
            const osc = this.audioContext.createOscillator();
            const noteGain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();
            
            osc.type = types[i];
            osc.frequency.value = freq;
            osc.detune.value = detunes[i] + (Math.random() * 4 - 2);
            
            filter.type = 'lowpass';
            filter.frequency.value = 2000 + Math.random() * 500;
            filter.Q.value = 1;
            
            osc.connect(filter);
            filter.connect(noteGain);
            noteGain.connect(gainNode);
            
            const vol = volume / 3;
            noteGain.gain.setValueAtTime(0, startTime);
            noteGain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
            noteGain.gain.setValueAtTime(vol, startTime + duration * 0.6);
            noteGain.gain.linearRampToValueAtTime(0, startTime + duration);
            
            osc.start(startTime);
            osc.stop(startTime + duration + 0.1);
            
            this.activeOscillators.push({ osc, noteGain, endTime: startTime + duration });
        }
    }
    
    // Epic pad/strings for atmosphere
    playPad(freq, startTime, duration, gainNode = this.musicGain, volume = 0.15) {
        if (!this.audioContext) return;
        
        // Multiple oscillators for rich pad sound
        const detunes = [-7, 0, 7];
        
        for (const detune of detunes) {
            const osc = this.audioContext.createOscillator();
            const noteGain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();
            
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            osc.detune.value = detune;
            
            filter.type = 'lowpass';
            filter.frequency.value = 800;
            filter.Q.value = 0.5;
            
            osc.connect(filter);
            filter.connect(noteGain);
            noteGain.connect(gainNode);
            
            const vol = volume / 3;
            // Slow attack for pad feel
            noteGain.gain.setValueAtTime(0, startTime);
            noteGain.gain.linearRampToValueAtTime(vol, startTime + duration * 0.3);
            noteGain.gain.setValueAtTime(vol, startTime + duration * 0.7);
            noteGain.gain.linearRampToValueAtTime(0, startTime + duration);
            
            osc.start(startTime);
            osc.stop(startTime + duration + 0.1);
            
            this.activeOscillators.push({ osc, noteGain, endTime: startTime + duration });
        }
    }
    
    // Power chord for epic moments
    playPowerChord(rootFreq, startTime, duration, gainNode = this.musicGain, volume = 0.3) {
        if (!this.audioContext) return;
        
        // Root, fifth, octave
        const freqs = [rootFreq, rootFreq * 1.5, rootFreq * 2];
        
        for (const freq of freqs) {
            const osc1 = this.audioContext.createOscillator();
            const osc2 = this.audioContext.createOscillator();
            const noteGain = this.audioContext.createGain();
            const distortion = this.audioContext.createWaveShaper();
            
            osc1.type = 'sawtooth';
            osc1.frequency.value = freq;
            osc2.type = 'square';
            osc2.frequency.value = freq;
            osc2.detune.value = 7;
            
            // Soft distortion curve
            const curve = new Float32Array(256);
            for (let i = 0; i < 256; i++) {
                const x = (i - 128) / 128;
                curve[i] = Math.tanh(x * 2);
            }
            distortion.curve = curve;
            
            osc1.connect(distortion);
            osc2.connect(distortion);
            distortion.connect(noteGain);
            noteGain.connect(gainNode);
            
            const vol = volume / 3;
            noteGain.gain.setValueAtTime(0, startTime);
            noteGain.gain.linearRampToValueAtTime(vol, startTime + 0.01);
            noteGain.gain.setValueAtTime(vol * 0.8, startTime + duration * 0.5);
            noteGain.gain.linearRampToValueAtTime(0, startTime + duration);
            
            osc1.start(startTime);
            osc2.start(startTime);
            osc1.stop(startTime + duration + 0.1);
            osc2.stop(startTime + duration + 0.1);
            
            this.activeOscillators.push({ osc: osc1, noteGain, endTime: startTime + duration });
            this.activeOscillators.push({ osc: osc2, noteGain, endTime: startTime + duration });
        }
    }
    
    // HEAVY 808 SUB BASS - Modern dark style that HITS HARD
    playSubBass(freq, startTime, duration, gainNode = this.musicGain, volume = 0.6) {
        if (!this.audioContext) return;
        
        // Layer 1: Deep sine sub
        const osc1 = this.audioContext.createOscillator();
        const noteGain1 = this.audioContext.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = freq;
        osc1.connect(noteGain1);
        noteGain1.connect(gainNode);
        
        // Hard attack, sustain, quick release - 808 style
        noteGain1.gain.setValueAtTime(0, startTime);
        noteGain1.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        noteGain1.gain.setValueAtTime(volume * 0.9, startTime + duration * 0.8);
        noteGain1.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        osc1.start(startTime);
        osc1.stop(startTime + duration + 0.1);
        
        // Layer 2: Octave up for punch
        const osc2 = this.audioContext.createOscillator();
        const noteGain2 = this.audioContext.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = freq * 2;
        osc2.connect(noteGain2);
        noteGain2.connect(gainNode);
        
        noteGain2.gain.setValueAtTime(0, startTime);
        noteGain2.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01);
        noteGain2.gain.exponentialRampToValueAtTime(0.01, startTime + duration * 0.5);
        
        osc2.start(startTime);
        osc2.stop(startTime + duration + 0.1);
        
        // Layer 3: Click transient for attack
        const osc3 = this.audioContext.createOscillator();
        const noteGain3 = this.audioContext.createGain();
        osc3.type = 'square';
        osc3.frequency.value = freq * 4;
        osc3.connect(noteGain3);
        noteGain3.connect(gainNode);
        
        noteGain3.gain.setValueAtTime(volume * 0.2, startTime);
        noteGain3.gain.exponentialRampToValueAtTime(0.01, startTime + 0.05);
        
        osc3.start(startTime);
        osc3.stop(startTime + 0.1);
        
        this.activeOscillators.push({ osc: osc1, noteGain: noteGain1, endTime: startTime + duration });
        this.activeOscillators.push({ osc: osc2, noteGain: noteGain2, endTime: startTime + duration });
    }

    // Note frequencies
    note(name, octave = 4) {
        const notes = {
            'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13,
            'E': 329.63, 'F': 349.23, 'F#': 369.99, 'G': 392.00,
            'G#': 415.30, 'A': 440.00, 'A#': 466.16, 'B': 493.88
        };
        const baseFreq = notes[name] || 440;
        return baseFreq * Math.pow(2, octave - 4);
    }

    // ========== TRACK 1: "Melancholy Pixels" - Slow, sad, reflective (EXTENDED) ==========
    track1() {
        this.tempo = 78;
        this.stepTime = 60 / this.tempo / 4;
        
        // E minor - haunting emo ballad style - MUCH LONGER with 6 sections
        const melody = [
            // Section A - Intro, longing
            { note: 'B', oct: 4, dur: 2 }, { note: 'E', oct: 5, dur: 3 }, { note: 'D', oct: 5, dur: 1 },
            { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'A', oct: 4, dur: 4 },
            { note: 'G', oct: 4, dur: 2 }, { note: 'A', oct: 4, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'D', oct: 5, dur: 2 },
            { note: 'E', oct: 5, dur: 8 },
            // Section B - Rising hope
            { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 3 }, { note: 'G', oct: 5, dur: 1 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 },
            { note: 'D', oct: 5, dur: 4 }, { note: 'B', oct: 4, dur: 4 },
            // Section C - Emotional peak
            { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 2 },
            { note: 'A', oct: 4, dur: 8 },
            // Section D - Contemplation
            { note: 'C', oct: 5, dur: 4 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'A', oct: 4, dur: 2 },
            { note: 'G', oct: 4, dur: 8 },
            // Section E - Second climax
            { note: 'B', oct: 4, dur: 1 }, { note: 'D', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 },
            { note: 'B', oct: 5, dur: 8 },
            // Section F - Resolution
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 },
            { note: 'D', oct: 5, dur: 4 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 2 }, { note: 'G', oct: 4, dur: 2 }, { note: 'F#', oct: 4, dur: 2 }, { note: 'E', oct: 4, dur: 2 },
            { note: 'E', oct: 4, dur: 8 }
        ];

        const bass = [
            // Section A
            { note: 'E', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'C', oct: 3, dur: 4 }, { note: 'D', oct: 3, dur: 4 },
            { note: 'E', oct: 2, dur: 8 },
            // Section B
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'C', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            // Section C
            { note: 'E', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section D
            { note: 'C', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 8 },
            // Section E
            { note: 'E', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'C', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 8 },
            // Section F
            { note: 'A', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'C', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 }
        ];

        const arp = [
            // Section A
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'C', 'G', 'E', 'G', 'D', 'A', 'F#', 'A',
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B',
            // Section B
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            'C', 'G', 'E', 'G', 'G', 'D', 'B', 'D',
            'A', 'E', 'C', 'E', 'E', 'B', 'G', 'B',
            'B', 'F#', 'D', 'F#', 'G', 'D', 'B', 'D',
            // Section C
            'E', 'B', 'G', 'B', 'B', 'F#', 'D', 'F#',
            'A', 'E', 'C', 'E', 'F#', 'D', 'A', 'D',
            'G', 'D', 'B', 'D', 'D', 'A', 'F#', 'A',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            // Section D
            'C', 'G', 'E', 'G', 'G', 'D', 'B', 'D',
            'A', 'E', 'C', 'E', 'E', 'B', 'G', 'B',
            'D', 'A', 'F#', 'A', 'A', 'E', 'C', 'E',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            // Section E
            'E', 'B', 'G', 'B', 'G', 'D', 'B', 'D',
            'A', 'E', 'C', 'E', 'D', 'A', 'F#', 'A',
            'C', 'G', 'E', 'G', 'A', 'E', 'C', 'E',
            'B', 'F#', 'D', 'F#', 'B', 'F#', 'D', 'F#',
            // Section F
            'A', 'E', 'C', 'E', 'G', 'D', 'B', 'D',
            'D', 'A', 'F#', 'A', 'B', 'F#', 'D', 'F#',
            'C', 'G', 'E', 'G', 'B', 'F#', 'D', 'F#',
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B'
        ];

        return { melody, bass, arp, name: 'Melancholy Pixels' };
    }

    // ========== TRACK 2: "Digital Tears" - Mid-tempo, emotional (EXTENDED) ==========
    track2() {
        this.tempo = 92;
        this.stepTime = 60 / this.tempo / 4;
        
        // A minor / F major - cinematic emo - EXTENDED with 6 sections
        const melody = [
            // Section A - Opening, questioning
            { note: 'E', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 3 }, { note: 'G', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 },
            { note: 'E', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 8 },
            // Section B - Building tension
            { note: 'C', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'C', oct: 6, dur: 8 },
            // Section C - Emotional release
            { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 },
            { note: 'E', oct: 5, dur: 8 },
            // Section D - Reflection
            { note: 'A', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 },
            { note: 'E', oct: 5, dur: 8 },
            // Section E - Second wave
            { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 },
            { note: 'G', oct: 5, dur: 8 },
            // Section F - Resolution
            { note: 'F', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 },
            { note: 'B', oct: 4, dur: 4 }, { note: 'C', oct: 5, dur: 4 },
            { note: 'A', oct: 4, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 2 },
            { note: 'A', oct: 4, dur: 8 }
        ];

        const bass = [
            // Section A
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'F', oct: 2, dur: 4 }, { note: 'C', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section B
            { note: 'C', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'F', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'C', oct: 2, dur: 8 },
            // Section C
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'F', oct: 2, dur: 4 }, { note: 'C', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 },
            // Section D
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 },
            // Section E
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'F', oct: 2, dur: 4 },
            { note: 'C', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 8 },
            // Section F
            { note: 'F', oct: 2, dur: 4 }, { note: 'C', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 }
        ];

        const arp = [
            // Section A
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'F', 'C', 'A', 'C', 'F', 'C', 'A', 'C',
            'D', 'A', 'F', 'A', 'A', 'E', 'C', 'E',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            // Section B
            'C', 'G', 'E', 'G', 'G', 'D', 'B', 'D',
            'F', 'C', 'A', 'C', 'E', 'B', 'G#', 'B',
            'D', 'A', 'F', 'A', 'G', 'D', 'B', 'D',
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            // Section C
            'G', 'D', 'B', 'D', 'D', 'A', 'F', 'A',
            'F', 'C', 'A', 'C', 'C', 'G', 'E', 'G',
            'A', 'E', 'C', 'E', 'D', 'A', 'F', 'A',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            // Section D
            'A', 'E', 'C', 'E', 'E', 'B', 'G#', 'B',
            'D', 'A', 'F', 'A', 'G', 'D', 'B', 'D',
            'A', 'E', 'C', 'E', 'D', 'A', 'F', 'A',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            // Section E
            'G', 'D', 'B', 'D', 'D', 'A', 'F', 'A',
            'A', 'E', 'C', 'E', 'F', 'C', 'A', 'C',
            'C', 'G', 'E', 'G', 'A', 'E', 'C', 'E',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            // Section F
            'F', 'C', 'A', 'C', 'C', 'G', 'E', 'G',
            'G', 'D', 'B', 'D', 'D', 'A', 'F', 'A',
            'A', 'E', 'C', 'E', 'E', 'B', 'G#', 'B',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E'
        ];

        return { melody, bass, arp, name: 'Digital Tears' };
    }

    // ========== TRACK 3: "Broken Circuits" - Faster, intense emo (EXTENDED) ==========
    track3() {
        this.tempo = 138;
        this.stepTime = 60 / this.tempo / 4;
        
        // D minor - punk emo energy - EXTENDED with 6 sections
        const melody = [
            // Section A - Urgent opening
            { note: 'D', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'G', oct: 5, dur: 1 },
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 },
            { note: 'E', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 1 },
            { note: 'C', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 },
            // Section B - Driving rhythm
            { note: 'F', oct: 5, dur: 1 }, { note: 'G', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 2 },
            { note: 'G', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 2 },
            { note: 'D', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'G', oct: 5, dur: 1 },
            { note: 'A', oct: 5, dur: 4 },
            // Section C - Climbing intensity
            { note: 'Bb', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 },
            { note: 'G', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 1 }, { note: 'Bb', oct: 5, dur: 2 },
            { note: 'C', oct: 6, dur: 2 }, { note: 'Bb', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 4 },
            // Section D - Peak and breakdown
            { note: 'D', oct: 6, dur: 2 }, { note: 'C', oct: 6, dur: 2 },
            { note: 'Bb', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 1 }, { note: 'G', oct: 5, dur: 2 },
            { note: 'F', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 2 },
            { note: 'C', oct: 5, dur: 4 },
            // Section E - Second wave
            { note: 'D', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 2 },
            { note: 'G', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 1 },
            { note: 'C', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'F', oct: 5, dur: 1 },
            { note: 'G', oct: 5, dur: 4 },
            // Section F - Resolution
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 },
            { note: 'F', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 1 }, { note: 'D', oct: 5, dur: 2 },
            { note: 'Bb', oct: 4, dur: 2 }, { note: 'A', oct: 4, dur: 2 },
            { note: 'D', oct: 5, dur: 4 }
        ];

        const bass = [
            // Section A
            { note: 'D', oct: 2, dur: 2 }, { note: 'D', oct: 2, dur: 2 },
            { note: 'D', oct: 2, dur: 2 }, { note: 'F', oct: 2, dur: 2 },
            { note: 'C', oct: 2, dur: 2 }, { note: 'C', oct: 2, dur: 2 },
            { note: 'C', oct: 2, dur: 2 }, { note: 'D', oct: 2, dur: 2 },
            // Section B
            { note: 'F', oct: 2, dur: 2 }, { note: 'G', oct: 2, dur: 2 },
            { note: 'A', oct: 2, dur: 2 }, { note: 'E', oct: 2, dur: 2 },
            { note: 'D', oct: 2, dur: 2 }, { note: 'F', oct: 2, dur: 2 },
            { note: 'A', oct: 2, dur: 4 },
            // Section C
            { note: 'Bb', oct: 1, dur: 2 }, { note: 'A', oct: 2, dur: 2 },
            { note: 'G', oct: 2, dur: 2 }, { note: 'Bb', oct: 1, dur: 2 },
            { note: 'C', oct: 2, dur: 2 }, { note: 'Bb', oct: 1, dur: 2 },
            { note: 'A', oct: 2, dur: 4 },
            // Section D
            { note: 'D', oct: 2, dur: 2 }, { note: 'C', oct: 2, dur: 2 },
            { note: 'Bb', oct: 1, dur: 2 }, { note: 'G', oct: 2, dur: 2 },
            { note: 'F', oct: 2, dur: 2 }, { note: 'D', oct: 2, dur: 2 },
            { note: 'C', oct: 2, dur: 4 },
            // Section E
            { note: 'D', oct: 2, dur: 2 }, { note: 'A', oct: 2, dur: 2 },
            { note: 'G', oct: 2, dur: 2 }, { note: 'D', oct: 2, dur: 2 },
            { note: 'C', oct: 2, dur: 2 }, { note: 'F', oct: 2, dur: 2 },
            { note: 'G', oct: 2, dur: 4 },
            // Section F
            { note: 'A', oct: 2, dur: 2 }, { note: 'G', oct: 2, dur: 2 },
            { note: 'F', oct: 2, dur: 2 }, { note: 'D', oct: 2, dur: 2 },
            { note: 'Bb', oct: 1, dur: 2 }, { note: 'A', oct: 2, dur: 2 },
            { note: 'D', oct: 2, dur: 4 }
        ];

        const arp = [
            // Section A
            'D', 'A', 'F', 'A', 'D', 'A', 'F', 'A',
            'D', 'A', 'F', 'A', 'F', 'C', 'A', 'C',
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            'C', 'G', 'E', 'G', 'D', 'A', 'F', 'A',
            // Section B
            'F', 'C', 'A', 'C', 'G', 'D', 'Bb', 'D',
            'A', 'E', 'C', 'E', 'E', 'B', 'G', 'B',
            'D', 'A', 'F', 'A', 'F', 'C', 'A', 'C',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            // Section C
            'Bb', 'F', 'D', 'F', 'A', 'E', 'C', 'E',
            'G', 'D', 'Bb', 'D', 'Bb', 'F', 'D', 'F',
            'C', 'G', 'E', 'G', 'Bb', 'F', 'D', 'F',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            // Section D
            'D', 'A', 'F', 'A', 'C', 'G', 'E', 'G',
            'Bb', 'F', 'D', 'F', 'G', 'D', 'Bb', 'D',
            'F', 'C', 'A', 'C', 'D', 'A', 'F', 'A',
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            // Section E
            'D', 'A', 'F', 'A', 'A', 'E', 'C', 'E',
            'G', 'D', 'Bb', 'D', 'D', 'A', 'F', 'A',
            'C', 'G', 'E', 'G', 'F', 'C', 'A', 'C',
            'G', 'D', 'Bb', 'D', 'G', 'D', 'Bb', 'D',
            // Section F
            'A', 'E', 'C', 'E', 'G', 'D', 'Bb', 'D',
            'F', 'C', 'A', 'C', 'D', 'A', 'F', 'A',
            'Bb', 'F', 'D', 'F', 'A', 'E', 'C', 'E',
            'D', 'A', 'F', 'A', 'D', 'A', 'F', 'A'
        ];

        return { melody, bass, arp, name: 'Broken Circuits' };
    }

    playTrack(trackNum) {
        this.init();
        this.stop();
        
        let track;
        switch(trackNum) {
            case 1: track = this.track1(); break;
            case 2: track = this.track2(); break;
            case 3: track = this.track3(); break;
            default: track = this.track1();
        }
        
        this.currentTrack = track;
        this.isPlaying = true;
        this.scheduleTrack(track);
        
        console.log(`Now playing: ${track.name}`);
    }

    scheduleTrack(track) {
        const now = this.audioContext.currentTime;
        let melodyTime = 0;
        let bassTime = 0;
        let arpTime = 0;
        let padTime = 0;
        
        // Schedule EPIC melody with thick notes
        for (const n of track.melody) {
            const freq = this.note(n.note, n.oct);
            const dur = n.dur * this.stepTime;
            // Use thick notes for lead melody
            this.playThickNote(freq, now + melodyTime, dur * 0.9, this.musicGain, 0.2);
            melodyTime += dur;
        }
        
        // Schedule deep sub bass
        for (const n of track.bass) {
            const freq = this.note(n.note, n.oct);
            const dur = n.dur * this.stepTime;
            this.playSubBass(freq, now + bassTime, dur * 0.85, this.musicGain, 0.35);
            // Also add mid bass layer
            this.playNote(freq * 2, now + bassTime, dur * 0.7, 'triangle', this.musicGain, 0.15);
            bassTime += dur;
        }
        
        // Schedule atmospheric pads (chords)
        if (track.pads) {
            for (const p of track.pads) {
                const freq = this.note(p.note, p.oct);
                const dur = p.dur * this.stepTime;
                this.playPad(freq, now + padTime, dur, this.musicGain, 0.12);
                // Add fifth for richer chord
                this.playPad(freq * 1.5, now + padTime, dur, this.musicGain, 0.08);
                padTime += dur;
            }
        }
        
        // Schedule arpeggios with filter sweep feel
        const arpStepTime = this.stepTime;
        for (let i = 0; i < track.arp.length; i++) {
            const noteName = track.arp[i];
            let freq;
            if (noteName === 'Bb') {
                freq = this.note('A#', 4);
            } else if (noteName === 'G#') {
                freq = this.note('G#', 4);
            } else {
                freq = this.note(noteName, 4);
            }
            // Alternate octaves for movement
            const octShift = (i % 4 < 2) ? 1 : 0.5;
            this.playNote(freq * octShift, now + arpTime, arpStepTime * 0.6, 'sawtooth', this.musicGain, 0.08);
            arpTime += arpStepTime;
        }
        
        // Loop
        const loopDuration = melodyTime * 1000;
        this.loopInterval = setTimeout(() => {
            if (this.isPlaying) {
                this.scheduleTrack(track);
            }
        }, loopDuration - 50);
    }

    stop() {
        this.isPlaying = false;
        if (this.loopInterval) {
            clearTimeout(this.loopInterval);
            this.loopInterval = null;
        }
        
        // Immediately stop all active music oscillators
        if (this.audioContext) {
            const now = this.audioContext.currentTime;
            for (const item of this.activeOscillators) {
                try {
                    item.noteGain.gain.cancelScheduledValues(now);
                    item.noteGain.gain.setValueAtTime(item.noteGain.gain.value, now);
                    item.noteGain.gain.linearRampToValueAtTime(0, now + 0.05);
                    item.osc.stop(now + 0.06);
                } catch (e) {
                    // Oscillator may have already stopped
                }
            }
            this.activeOscillators = [];
        }
    }

    // ========== SOUND EFFECTS ==========
    
    playFlap() {
        this.init();
        const now = this.audioContext.currentTime;
        
        // Wing flap sound - noise burst with filter sweep (like feathers)
        const bufferSize = this.audioContext.sampleRate * 0.06;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        // Create filtered noise that sounds like a wing flap
        for (let i = 0; i < bufferSize; i++) {
            // Envelope shape - quick attack, medium decay
            const env = Math.exp(-i / (bufferSize * 0.15));
            // Noise with some tonal quality
            data[i] = (Math.random() * 2 - 1) * env * 0.5;
        }
        
        const noiseSource = this.audioContext.createBufferSource();
        noiseSource.buffer = buffer;
        
        // Bandpass filter for "whoosh" quality
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.linearRampToValueAtTime(1500, now + 0.03);
        filter.Q.value = 1.5;
        
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(1.2, now);  // VERY LOUD
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        
        noiseSource.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        
        noiseSource.start(now);
        noiseSource.stop(now + 0.12);
        
        // Add a tonal "flick" for 8-bit feel - MUCH LOUDER
        const osc = this.audioContext.createOscillator();
        const oscGain = this.audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.04);
        oscGain.gain.setValueAtTime(0.4, now);  // MUCH LOUDER
        oscGain.gain.linearRampToValueAtTime(0, now + 0.08);
        osc.connect(oscGain);
        oscGain.connect(this.sfxGain);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    playScore() {
        this.init();
        const now = this.audioContext.currentTime;
        
        // Bassy score sound - low punchy note
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, now); // Low bass note
        osc.frequency.linearRampToValueAtTime(180, now + 0.05); // Slight rise
        
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        
        osc.connect(gain);
        gain.connect(this.sfxGain);
        
        osc.start(now);
        osc.stop(now + 0.2);
    }

    playDeath() {
        this.init();
        const now = this.audioContext.currentTime;
        
        // Dramatic death sound - descending minor arpeggio with distortion
        // First: impact hit
        const impactOsc = this.audioContext.createOscillator();
        const impactGain = this.audioContext.createGain();
        impactOsc.type = 'sawtooth';
        impactOsc.frequency.setValueAtTime(150, now);
        impactOsc.frequency.linearRampToValueAtTime(50, now + 0.15);
        impactGain.gain.setValueAtTime(0.4, now);
        impactGain.gain.linearRampToValueAtTime(0, now + 0.2);
        impactOsc.connect(impactGain);
        impactGain.connect(this.sfxGain);
        impactOsc.start(now);
        impactOsc.stop(now + 0.25);
        
        // Second: sad descending notes (minor chord breakdown)
        const deathNotes = [
            { freq: 440, time: 0.1, dur: 0.2 },   // A
            { freq: 349, time: 0.25, dur: 0.2 },  // F
            { freq: 294, time: 0.4, dur: 0.25 },  // D
            { freq: 220, time: 0.6, dur: 0.4 }    // A (low)
        ];
        
        for (const n of deathNotes) {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.type = 'square';
            osc.frequency.value = n.freq;
            gain.gain.setValueAtTime(0, now + n.time);
            gain.gain.linearRampToValueAtTime(0.2, now + n.time + 0.02);
            gain.gain.linearRampToValueAtTime(0, now + n.time + n.dur);
            osc.connect(gain);
            gain.connect(this.sfxGain);
            osc.start(now + n.time);
            osc.stop(now + n.time + n.dur + 0.1);
        }
        
        // Third: final low rumble
        const rumbleOsc = this.audioContext.createOscillator();
        const rumbleGain = this.audioContext.createGain();
        rumbleOsc.type = 'triangle';
        rumbleOsc.frequency.setValueAtTime(80, now + 0.8);
        rumbleOsc.frequency.linearRampToValueAtTime(40, now + 1.2);
        rumbleGain.gain.setValueAtTime(0, now + 0.8);
        rumbleGain.gain.linearRampToValueAtTime(0.25, now + 0.85);
        rumbleGain.gain.linearRampToValueAtTime(0, now + 1.3);
        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(this.sfxGain);
        rumbleOsc.start(now + 0.8);
        rumbleOsc.stop(now + 1.4);
    }

    playHighScore() {
        this.init();
        const now = this.audioContext.currentTime;
        
        // Triumphant fanfare
        const notes = [
            { n: 'C', o: 5, t: 0 },
            { n: 'E', o: 5, t: 0.1 },
            { n: 'G', o: 5, t: 0.2 },
            { n: 'C', o: 6, t: 0.3 },
            { n: 'G', o: 5, t: 0.5 },
            { n: 'C', o: 6, t: 0.6 }
        ];
        
        for (const n of notes) {
            this.playNote(this.note(n.n, n.o), now + n.t, 0.2, 'square', this.sfxGain, 0.25);
        }
    }

    playClick() {
        this.init();
        const now = this.audioContext.currentTime;
        
        // Satisfying button click - two-tone blip
        const osc1 = this.audioContext.createOscillator();
        const osc2 = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc1.type = 'square';
        osc1.frequency.value = 600;
        osc2.type = 'square';
        osc2.frequency.value = 900;
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + 0.06);
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.sfxGain);
        
        osc1.start(now);
        osc2.start(now + 0.02);
        osc1.stop(now + 0.03);
        osc2.stop(now + 0.07);
    }

    // ========== TRACK: "MIDNIGHT REQUIEM" - SLOW DARK EMO ==========
    // SLOW, HEAVY, EMOTIONAL - proper dark emo vibes
    // - 72 BPM - SLOW so bass can breathe and hit hard
    // - C minor - coldest key
    // - Long sustained emotional melodies
    // - HEAVY sub bass you can FEEL
    trackMenu() {
        this.tempo = 72; // SLOW - let it breathe, feel the weight
        this.stepTime = 60 / this.tempo / 4;
        
        // C MINOR - Cold, dark, emotional
        // Simple but powerful melody - think emo ballad meets dark synth
        const melody = [
            // INTRO - Let the bass and atmosphere set the mood (32 beats)
            { note: 'C', oct: 5, dur: 16 },
            { note: 'Eb', oct: 5, dur: 16 },
            
            // SECTION A - Emotional hook (simple, memorable)
            { note: 'G', oct: 5, dur: 4 }, { note: 'Eb', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'Eb', oct: 5, dur: 4 }, { note: 'C', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 8 },
            // Answer
            { note: 'G', oct: 5, dur: 4 }, { note: 'Ab', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 4 }, { note: 'F', oct: 5, dur: 4 },
            { note: 'Eb', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 8 },
            
            // SECTION B - Rising emotion
            { note: 'Ab', oct: 5, dur: 4 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 4 }, { note: 'Eb', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 4 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'Ab', oct: 5, dur: 8 },
            // Climax phrase
            { note: 'Bb', oct: 5, dur: 4 }, { note: 'Ab', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 4 }, { note: 'F', oct: 5, dur: 4 },
            { note: 'Eb', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 8 },
            
            // SECTION C - Breakdown (sparse, let bass dominate)
            { note: 'C', oct: 4, dur: 8 }, { note: 'Eb', oct: 4, dur: 8 },
            { note: 'G', oct: 4, dur: 8 }, { note: 'C', oct: 5, dur: 8 },
            
            // SECTION D - Return (emotional resolution)
            { note: 'G', oct: 5, dur: 4 }, { note: 'Eb', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'Eb', oct: 5, dur: 4 }, { note: 'C', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 8 }
        ];

        // HEAVY 808 BASS - Slow, deep, you FEEL it
        // i - VI - iv - V progression (dark emo classic)
        const bass = [
            // Intro - Let it rumble
            { note: 'C', oct: 1, dur: 8 }, { note: 'C', oct: 1, dur: 8 },
            { note: 'Ab', oct: 1, dur: 8 }, { note: 'Ab', oct: 1, dur: 8 },
            // Section A
            { note: 'C', oct: 1, dur: 8 }, { note: 'Ab', oct: 1, dur: 8 },
            { note: 'F', oct: 1, dur: 8 }, { note: 'G', oct: 1, dur: 8 },
            { note: 'C', oct: 1, dur: 8 }, { note: 'Ab', oct: 1, dur: 8 },
            { note: 'Eb', oct: 1, dur: 8 }, { note: 'G', oct: 1, dur: 8 },
            // Section B
            { note: 'Ab', oct: 1, dur: 8 }, { note: 'Eb', oct: 1, dur: 8 },
            { note: 'F', oct: 1, dur: 8 }, { note: 'G', oct: 1, dur: 8 },
            { note: 'Ab', oct: 1, dur: 8 }, { note: 'Bb', oct: 1, dur: 8 },
            { note: 'G', oct: 1, dur: 8 }, { note: 'C', oct: 1, dur: 8 },
            // Section C - Breakdown
            { note: 'C', oct: 1, dur: 16 },
            { note: 'Ab', oct: 1, dur: 16 },
            // Section D
            { note: 'C', oct: 1, dur: 8 }, { note: 'Ab', oct: 1, dur: 8 },
            { note: 'F', oct: 1, dur: 8 }, { note: 'C', oct: 1, dur: 8 }
        ];

        // SLOW ARPEGGIOS - Atmospheric, not busy
        const arp = [
            // Intro
            'C', 'Eb', 'G', 'Eb', 'C', 'Eb', 'G', 'Eb',
            'C', 'Eb', 'G', 'Eb', 'C', 'Eb', 'G', 'Eb',
            'Ab', 'C', 'Eb', 'C', 'Ab', 'C', 'Eb', 'C',
            'Ab', 'C', 'Eb', 'C', 'Ab', 'C', 'Eb', 'C',
            // Section A
            'C', 'Eb', 'G', 'Eb', 'Ab', 'C', 'Eb', 'C',
            'F', 'Ab', 'C', 'Ab', 'G', 'B', 'D', 'B',
            'C', 'Eb', 'G', 'Eb', 'Ab', 'C', 'Eb', 'C',
            'Eb', 'G', 'Bb', 'G', 'G', 'B', 'D', 'B',
            // Section B
            'Ab', 'C', 'Eb', 'C', 'Eb', 'G', 'Bb', 'G',
            'F', 'Ab', 'C', 'Ab', 'G', 'B', 'D', 'B',
            'Ab', 'C', 'Eb', 'C', 'Bb', 'D', 'F', 'D',
            'G', 'B', 'D', 'B', 'C', 'Eb', 'G', 'Eb',
            // Section C - Sparse
            'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G',
            'Ab', 'Eb', 'Ab', 'Eb', 'Ab', 'Eb', 'Ab', 'Eb',
            'G', 'D', 'G', 'D', 'G', 'D', 'G', 'D',
            'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G',
            // Section D
            'C', 'Eb', 'G', 'Eb', 'Ab', 'C', 'Eb', 'C',
            'F', 'Ab', 'C', 'Ab', 'G', 'B', 'D', 'B',
            'C', 'Eb', 'G', 'Eb', 'C', 'Eb', 'G', 'Eb',
            'C', 'Eb', 'G', 'Eb', 'C', 'Eb', 'G', 'Eb'
        ];
        
        // DARK PADS - Long, atmospheric
        const pads = [
            // Intro
            { note: 'C', oct: 3, dur: 32 },
            // Section A
            { note: 'C', oct: 3, dur: 16 }, { note: 'Ab', oct: 2, dur: 16 },
            { note: 'F', oct: 3, dur: 16 }, { note: 'G', oct: 3, dur: 16 },
            // Section B
            { note: 'Ab', oct: 3, dur: 16 }, { note: 'Eb', oct: 3, dur: 16 },
            { note: 'Bb', oct: 3, dur: 16 }, { note: 'C', oct: 3, dur: 16 },
            // Section C
            { note: 'C', oct: 3, dur: 32 },
            // Section D
            { note: 'C', oct: 3, dur: 16 }, { note: 'Ab', oct: 2, dur: 16 }
        ];

        return { melody, bass, arp, pads, name: 'Midnight Requiem' };
    }

    // ========== GAME OVER SONG - Slow, melancholy, reflective (EXTENDED 6 SECTIONS) ==========
    trackGameOver() {
        this.tempo = 58;
        this.stepTime = 60 / this.tempo / 4;
        
        // A minor - sad, reflective - 6 SECTIONS for longer emotional journey
        const melody = [
            // Section A - Sigh of defeat
            { note: 'E', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 6 }, { note: 'B', oct: 4, dur: 2 },
            { note: 'A', oct: 4, dur: 4 }, { note: 'G', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 8 },
            // Section B - Memories
            { note: 'C', oct: 5, dur: 3 }, { note: 'D', oct: 5, dur: 1 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 4 }, { note: 'C', oct: 5, dur: 4 },
            { note: 'B', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 8 },
            // Section C - What could have been
            { note: 'G', oct: 5, dur: 4 }, { note: 'F', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 2 }, { note: 'A', oct: 4, dur: 4 },
            { note: 'G', oct: 4, dur: 8 },
            // Section D - Acceptance
            { note: 'A', oct: 4, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'C', oct: 5, dur: 2 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 4 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'C', oct: 5, dur: 8 },
            // Section E - Glimmer of hope
            { note: 'E', oct: 5, dur: 2 }, { note: 'F', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'C', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 8 },
            // Section F - Final rest
            { note: 'C', oct: 5, dur: 4 }, { note: 'B', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 4 }, { note: 'G', oct: 4, dur: 4 },
            { note: 'A', oct: 4, dur: 8 },
            { note: 'A', oct: 4, dur: 8 }
        ];

        const bass = [
            // Section A
            { note: 'A', oct: 2, dur: 8 },
            { note: 'F', oct: 2, dur: 8 },
            { note: 'E', oct: 2, dur: 8 },
            { note: 'A', oct: 2, dur: 8 },
            // Section B
            { note: 'F', oct: 2, dur: 8 },
            { note: 'G', oct: 2, dur: 8 },
            { note: 'C', oct: 2, dur: 8 },
            { note: 'E', oct: 2, dur: 8 },
            // Section C
            { note: 'G', oct: 2, dur: 8 },
            { note: 'F', oct: 2, dur: 8 },
            { note: 'A', oct: 2, dur: 8 },
            { note: 'G', oct: 2, dur: 8 },
            // Section D
            { note: 'A', oct: 2, dur: 8 },
            { note: 'D', oct: 2, dur: 8 },
            { note: 'E', oct: 2, dur: 8 },
            { note: 'C', oct: 2, dur: 8 },
            // Section E
            { note: 'F', oct: 2, dur: 8 },
            { note: 'G', oct: 2, dur: 8 },
            { note: 'A', oct: 2, dur: 8 },
            { note: 'D', oct: 2, dur: 8 },
            // Section F
            { note: 'C', oct: 2, dur: 8 },
            { note: 'E', oct: 2, dur: 8 },
            { note: 'A', oct: 2, dur: 8 },
            { note: 'A', oct: 2, dur: 8 }
        ];

        const arp = [
            // Section A
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'F', 'C', 'A', 'C', 'F', 'C', 'A', 'C',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            // Section B
            'F', 'C', 'A', 'C', 'F', 'C', 'A', 'C',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            // Section C
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            'F', 'C', 'A', 'C', 'F', 'C', 'A', 'C',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            // Section D
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'D', 'A', 'F', 'A', 'D', 'A', 'F', 'A',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            // Section E
            'F', 'C', 'A', 'C', 'F', 'C', 'A', 'C',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'D', 'A', 'F', 'A', 'D', 'A', 'F', 'A',
            // Section F
            'C', 'G', 'E', 'G', 'C', 'G', 'E', 'G',
            'E', 'B', 'G#', 'B', 'E', 'B', 'G#', 'B',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E',
            'A', 'E', 'C', 'E', 'A', 'E', 'C', 'E'
        ];

        return { melody, bass, arp, name: 'Farewell' };
    }

    playMenuMusic() {
        this.init();
        this.stop();
        const track = this.trackMenu();
        this.currentTrack = track;
        this.isPlaying = true;
        this.scheduleTrack(track);
        console.log(`Now playing: ${track.name}`);
    }

    playGameOverMusic() {
        this.init();
        this.stop();
        const track = this.trackGameOver();
        this.currentTrack = track;
        this.isPlaying = true;
        this.scheduleTrack(track);
        console.log(`Now playing: ${track.name}`);
    }

    // ========== LEADERBOARD SONG - Triumphant, competitive, epic (EXTENDED 6 SECTIONS) ==========
    trackLeaderboard() {
        this.tempo = 108;
        this.stepTime = 60 / this.tempo / 4;
        
        // D major - heroic, triumphant - 6 SECTIONS for epic feel
        const melody = [
            // Section A - Fanfare opening
            { note: 'D', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 8 },
            // Section B - Rising glory
            { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'B', oct: 5, dur: 2 }, { note: 'C#', oct: 6, dur: 2 }, { note: 'D', oct: 6, dur: 4 },
            { note: 'C#', oct: 6, dur: 8 },
            // Section C - Champion theme
            { note: 'D', oct: 6, dur: 4 }, { note: 'C#', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 4 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 8 },
            // Section D - Victory lap
            { note: 'D', oct: 5, dur: 1 }, { note: 'F#', oct: 5, dur: 1 }, { note: 'A', oct: 5, dur: 1 }, { note: 'D', oct: 6, dur: 1 },
            { note: 'C#', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 1 }, { note: 'B', oct: 5, dur: 1 }, { note: 'C#', oct: 6, dur: 1 }, { note: 'D', oct: 6, dur: 1 },
            { note: 'E', oct: 6, dur: 4 },
            { note: 'D', oct: 6, dur: 8 },
            // Section E - Celebration
            { note: 'B', oct: 5, dur: 2 }, { note: 'C#', oct: 6, dur: 2 }, { note: 'D', oct: 6, dur: 4 },
            { note: 'C#', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 8 },
            // Section F - Grand finale
            { note: 'F#', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'D', oct: 6, dur: 4 },
            { note: 'C#', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'D', oct: 5, dur: 8 }
        ];

        const bass = [
            // Section A
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 8 },
            // Section B
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section C
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section D
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 8 },
            // Section E
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section F
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 8 }
        ];

        const arp = [
            // Section A
            'D', 'F#', 'A', 'F#', 'D', 'F#', 'A', 'F#',
            'B', 'D', 'F#', 'D', 'B', 'D', 'F#', 'D',
            'G', 'B', 'D', 'B', 'A', 'C#', 'E', 'C#',
            'D', 'F#', 'A', 'F#', 'D', 'F#', 'A', 'F#',
            // Section B
            'G', 'B', 'D', 'B', 'D', 'F#', 'A', 'F#',
            'E', 'G', 'B', 'G', 'A', 'C#', 'E', 'C#',
            'B', 'D', 'F#', 'D', 'D', 'F#', 'A', 'F#',
            'A', 'C#', 'E', 'C#', 'A', 'C#', 'E', 'C#',
            // Section C
            'D', 'F#', 'A', 'F#', 'A', 'C#', 'E', 'C#',
            'G', 'B', 'D', 'B', 'E', 'G', 'B', 'G',
            'D', 'F#', 'A', 'F#', 'B', 'D', 'F#', 'D',
            'A', 'C#', 'E', 'C#', 'A', 'C#', 'E', 'C#',
            // Section D
            'D', 'F#', 'A', 'F#', 'A', 'C#', 'E', 'C#',
            'B', 'D', 'F#', 'D', 'E', 'G', 'B', 'G',
            'D', 'F#', 'A', 'F#', 'D', 'F#', 'A', 'F#',
            // Section E
            'G', 'B', 'D', 'B', 'D', 'F#', 'A', 'F#',
            'A', 'C#', 'E', 'C#', 'E', 'G', 'B', 'G',
            'G', 'B', 'D', 'B', 'B', 'D', 'F#', 'D',
            'A', 'C#', 'E', 'C#', 'A', 'C#', 'E', 'C#',
            // Section F
            'D', 'F#', 'A', 'F#', 'A', 'C#', 'E', 'C#',
            'B', 'D', 'F#', 'D', 'F#', 'A', 'C#', 'A',
            'G', 'B', 'D', 'B', 'A', 'C#', 'E', 'C#',
            'D', 'F#', 'A', 'F#', 'D', 'F#', 'A', 'F#'
        ];

        return { melody, bass, arp, name: 'Hall of Champions' };
    }

    playLeaderboardMusic() {
        this.init();
        this.stop();
        const track = this.trackLeaderboard();
        this.currentTrack = track;
        this.isPlaying = true;
        this.scheduleTrack(track);
        console.log(`Now playing: ${track.name}`);
    }

    setMusicVolume(vol) {
        if (this.musicGain) {
            this.musicGain.gain.value = Math.max(0, Math.min(1, vol));
        }
    }

    setSfxVolume(vol) {
        if (this.sfxGain) {
            this.sfxGain.gain.value = Math.max(0, Math.min(1, vol));
        }
    }

    setMasterVolume(vol) {
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
        }
    }

    mute() {
        this.isMuted = true;
        this.setMasterVolume(0);
        // Save to localStorage so it persists across pages
        try { localStorage.setItem('flapEmonadMuted', 'true'); } catch(e) {}
    }

    unmute() {
        this.isMuted = false;
        this.setMasterVolume(0.3);
        // Save to localStorage so it persists across pages
        try { localStorage.setItem('flapEmonadMuted', 'false'); } catch(e) {}
    }

    toggleMute() {
        if (this.isMuted) {
            this.unmute();
        } else {
            this.mute();
        }
        return this.isMuted;
    }
    
    // Load mute state from localStorage
    loadMuteState() {
        try {
            const saved = localStorage.getItem('flapEmonadMuted');
            if (saved === 'true') {
                this.isMuted = true;
            } else {
                this.isMuted = false;
            }
        } catch(e) {
            this.isMuted = false;
        }
    }
}


const chiptunePlayer = new ChiptunePlayer();

chiptunePlayer.loadMuteState();
