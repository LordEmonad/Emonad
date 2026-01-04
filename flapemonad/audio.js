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
        
        // Schedule melody
        for (const n of track.melody) {
            const freq = this.note(n.note, n.oct);
            const dur = n.dur * this.stepTime;
            this.playNote(freq, now + melodyTime, dur * 0.9, 'square', this.musicGain, 0.25);
            melodyTime += dur;
        }
        
        // Schedule bass
        for (const n of track.bass) {
            const freq = this.note(n.note, n.oct);
            const dur = n.dur * this.stepTime;
            this.playNote(freq, now + bassTime, dur * 0.8, 'triangle', this.musicGain, 0.35);
            bassTime += dur;
        }
        
        // Schedule arpeggios
        const arpStepTime = this.stepTime;
        for (let i = 0; i < track.arp.length; i++) {
            const noteName = track.arp[i];
            // Handle flats
            let freq;
            if (noteName === 'Bb') {
                freq = this.note('A#', 4);
            } else if (noteName === 'G#') {
                freq = this.note('G#', 4);
            } else {
                freq = this.note(noteName, 4);
            }
            this.playNote(freq, now + arpTime, arpStepTime * 0.7, 'sawtooth', this.musicGain, 0.1);
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

    // ========== HOME SCREEN SONG - "Pixel Hearts" - EMO ANTHEM (8 SECTIONS) ==========
    // This is THE theme song - emotional, catchy, memorable, emo vibes
    trackMenu() {
        this.tempo = 95; // Slower, more emotional emo tempo
        this.stepTime = 60 / this.tempo / 4;
        
        // E minor / B minor - classic emo progression, emotional and catchy
        const melody = [
            // Section A - Iconic opening hook (the part people remember)
            { note: 'B', oct: 4, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 4 },
            // Section B - Building emotion
            { note: 'E', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'B', oct: 4, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'D', oct: 5, dur: 2 },
            { note: 'E', oct: 5, dur: 8 },
            // Section C - The emotional climb
            { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'B', oct: 5, dur: 2 }, { note: 'D', oct: 6, dur: 2 }, { note: 'C#', oct: 6, dur: 4 },
            { note: 'B', oct: 5, dur: 8 },
            // Section D - CHORUS - The big emotional moment
            { note: 'E', oct: 6, dur: 4 }, { note: 'D', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'C#', oct: 6, dur: 4 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 2 }, { note: 'C#', oct: 6, dur: 2 }, { note: 'D', oct: 6, dur: 2 },
            { note: 'E', oct: 6, dur: 8 },
            // Section E - Breakdown (softer, introspective)
            { note: 'G', oct: 5, dur: 4 }, { note: 'F#', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 4 }, { note: 'D', oct: 5, dur: 4 },
            { note: 'B', oct: 4, dur: 2 }, { note: 'D', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 },
            { note: 'F#', oct: 5, dur: 8 },
            // Section F - Building back up
            { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 2 }, { note: 'C#', oct: 6, dur: 4 },
            { note: 'B', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 2 }, { note: 'B', oct: 5, dur: 2 },
            { note: 'A', oct: 5, dur: 8 },
            // Section G - Second chorus (even bigger)
            { note: 'E', oct: 6, dur: 2 }, { note: 'F#', oct: 6, dur: 2 }, { note: 'E', oct: 6, dur: 4 },
            { note: 'D', oct: 6, dur: 2 }, { note: 'C#', oct: 6, dur: 2 }, { note: 'B', oct: 5, dur: 4 },
            { note: 'C#', oct: 6, dur: 2 }, { note: 'D', oct: 6, dur: 2 }, { note: 'E', oct: 6, dur: 4 },
            { note: 'D', oct: 6, dur: 8 },
            // Section H - Outro (memorable ending)
            { note: 'B', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'F#', oct: 5, dur: 2 }, { note: 'G', oct: 5, dur: 2 }, { note: 'A', oct: 5, dur: 4 },
            { note: 'G', oct: 5, dur: 2 }, { note: 'F#', oct: 5, dur: 2 }, { note: 'E', oct: 5, dur: 4 },
            { note: 'E', oct: 5, dur: 8 }
        ];

        const bass = [
            // Section A - Em -> D -> G -> F#m
            { note: 'E', oct: 2, dur: 4 }, { note: 'G', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'F#', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            // Section B
            { note: 'E', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'B', oct: 1, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 },
            // Section C
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'F#', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'B', oct: 2, dur: 8 },
            // Section D - Chorus bass
            { note: 'E', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 },
            // Section E - Breakdown
            { note: 'G', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'B', oct: 1, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'F#', oct: 2, dur: 8 },
            // Section F
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'D', oct: 2, dur: 4 },
            { note: 'F#', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 8 },
            // Section G - Second chorus
            { note: 'E', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 4 }, { note: 'B', oct: 2, dur: 4 },
            { note: 'A', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'D', oct: 2, dur: 8 },
            // Section H - Outro
            { note: 'G', oct: 2, dur: 4 }, { note: 'E', oct: 2, dur: 4 },
            { note: 'F#', oct: 2, dur: 4 }, { note: 'A', oct: 2, dur: 4 },
            { note: 'G', oct: 2, dur: 4 }, { note: 'F#', oct: 2, dur: 4 },
            { note: 'E', oct: 2, dur: 8 }
        ];

        const arp = [
            // Section A - Em vibes
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B',
            'D', 'A', 'F#', 'A', 'D', 'A', 'F#', 'A',
            'G', 'D', 'B', 'D', 'G', 'D', 'B', 'D',
            'F#', 'C#', 'A', 'C#', 'F#', 'C#', 'A', 'C#',
            // Section B
            'E', 'B', 'G', 'B', 'D', 'A', 'F#', 'A',
            'B', 'F#', 'D', 'F#', 'E', 'B', 'G', 'B',
            'G', 'D', 'B', 'D', 'D', 'A', 'F#', 'A',
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B',
            // Section C
            'G', 'D', 'B', 'D', 'D', 'A', 'F#', 'A',
            'F#', 'C#', 'A', 'C#', 'A', 'E', 'C#', 'E',
            'B', 'F#', 'D', 'F#', 'A', 'E', 'C#', 'E',
            'B', 'F#', 'D', 'F#', 'B', 'F#', 'D', 'F#',
            // Section D - Chorus
            'E', 'B', 'G', 'B', 'B', 'F#', 'D', 'F#',
            'A', 'E', 'C#', 'E', 'B', 'F#', 'D', 'F#',
            'A', 'E', 'C#', 'E', 'D', 'A', 'F#', 'A',
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B',
            // Section E - Breakdown
            'G', 'D', 'B', 'D', 'F#', 'C#', 'A', 'C#',
            'E', 'B', 'G', 'B', 'D', 'A', 'F#', 'A',
            'B', 'F#', 'D', 'F#', 'E', 'B', 'G', 'B',
            'F#', 'C#', 'A', 'C#', 'F#', 'C#', 'A', 'C#',
            // Section F
            'A', 'E', 'C#', 'E', 'E', 'B', 'G', 'B',
            'G', 'D', 'B', 'D', 'D', 'A', 'F#', 'A',
            'F#', 'C#', 'A', 'C#', 'B', 'F#', 'D', 'F#',
            'A', 'E', 'C#', 'E', 'A', 'E', 'C#', 'E',
            // Section G - Second chorus
            'E', 'B', 'G', 'B', 'F#', 'C#', 'A', 'C#',
            'D', 'A', 'F#', 'A', 'B', 'F#', 'D', 'F#',
            'A', 'E', 'C#', 'E', 'E', 'B', 'G', 'B',
            'D', 'A', 'F#', 'A', 'D', 'A', 'F#', 'A',
            // Section H - Outro
            'G', 'D', 'B', 'D', 'E', 'B', 'G', 'B',
            'F#', 'C#', 'A', 'C#', 'A', 'E', 'C#', 'E',
            'G', 'D', 'B', 'D', 'F#', 'C#', 'A', 'C#',
            'E', 'B', 'G', 'B', 'E', 'B', 'G', 'B'
        ];

        return { melody, bass, arp, name: 'Pixel Hearts' };
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

// Global instance
const chiptunePlayer = new ChiptunePlayer();
// Load saved mute state from localStorage
chiptunePlayer.loadMuteState();
