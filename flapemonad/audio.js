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
        this.activeNodes = [];
        this.playTimeout = null;
        this.playId = 0;
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

    // --- core note playing ---
    
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
        this.activeNodes.push({ osc, gain, end: startTime + duration });
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
        this.activeNodes.push({ osc: osc1, gain: gain1, end: startTime + duration });
        
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
        this.activeNodes.push({ osc: osc2, gain: gain2, end: startTime + duration });
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
        this.activeNodes.push({ osc, gain, end: startTime + duration });
    }

    // Kick drum - punchy 808
    playKick(startTime, volume = 0.5) {
        if (!this.audioContext) return;
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, startTime);
        osc.frequency.exponentialRampToValueAtTime(35, startTime + 0.08);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(startTime);
        osc.stop(startTime + 0.25);
        
        // Click attack
        const click = this.audioContext.createOscillator();
        const clickGain = this.audioContext.createGain();
        click.type = 'square';
        click.frequency.value = 900;
        clickGain.gain.setValueAtTime(volume * 0.3, startTime);
        clickGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.01);
        click.connect(clickGain);
        clickGain.connect(this.musicGain);
        click.start(startTime);
        click.stop(startTime + 0.02);
    }

    // Snare drum
    playSnare(startTime, volume = 0.4) {
        if (!this.audioContext) return;
        
        // Noise burst
        const bufferSize = this.audioContext.sampleRate * 0.12;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2500;
        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.setValueAtTime(volume, startTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.musicGain);
        noise.start(startTime);
        noise.stop(startTime + 0.15);
        
        // Body tone
        const osc = this.audioContext.createOscillator();
        const oscGain = this.audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, startTime);
        osc.frequency.exponentialRampToValueAtTime(100, startTime + 0.03);
        oscGain.gain.setValueAtTime(volume * 0.5, startTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);
        osc.connect(oscGain);
        oscGain.connect(this.musicGain);
        osc.start(startTime);
        osc.stop(startTime + 0.08);
    }

    // Hi-hat
    playHiHat(startTime, volume = 0.15) {
        if (!this.audioContext) return;
        const bufferSize = this.audioContext.sampleRate * 0.04;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.06));
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 9000;
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.03);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        noise.start(startTime);
        noise.stop(startTime + 0.05);
    }

    // Open hi-hat
    playOpenHat(startTime, volume = 0.12) {
        if (!this.audioContext) return;
        const bufferSize = this.audioContext.sampleRate * 0.15;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7000;
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        noise.start(startTime);
        noise.stop(startTime + 0.15);
    }

    // Crash cymbal
    playCrash(startTime, volume = 0.18) {
        if (!this.audioContext) return;
        const bufferSize = this.audioContext.sampleRate * 0.6;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 5000;
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        noise.start(startTime);
        noise.stop(startTime + 0.6);
    }

    // Tom drum
    playTom(startTime, freq = 150, volume = 0.3) {
        if (!this.audioContext) return;
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.5, startTime + 0.12);
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
    }

    // --- track 1: neon funeral (110 bpm) ---
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
        
        // DRUMS - Driving rock beat
        for (let bar = 0; bar < 16; bar++) {
            const barStart = now + bar * 4 * beatTime;
            // Kick on 1 and 3
            this.playKick(barStart, 0.45);
            this.playKick(barStart + 2 * beatTime, 0.45);
            // Snare on 2 and 4
            this.playSnare(barStart + beatTime, 0.35);
            this.playSnare(barStart + 3 * beatTime, 0.35);
            // Hi-hats on 8ths
            for (let i = 0; i < 8; i++) {
                const vol = (i % 2 === 0) ? 0.12 : 0.08;
                this.playHiHat(barStart + i * beatTime / 2, vol);
            }
            // Open hat on "and" of 4
            this.playOpenHat(barStart + 3.5 * beatTime, 0.1);
            // Crash every 4 bars
            if (bar % 4 === 0) {
                this.playCrash(barStart, 0.15);
            }
            // Tom fill on bar 8 and 16
            if (bar === 7 || bar === 15) {
                this.playTom(barStart + 3 * beatTime, 180, 0.25);
                this.playTom(barStart + 3.25 * beatTime, 140, 0.25);
                this.playTom(barStart + 3.5 * beatTime, 110, 0.25);
                this.playTom(barStart + 3.75 * beatTime, 90, 0.25);
            }
        }
        
        // Loop after 64 beats
        const loopTime = 64 * beatTime * 1000;
        const loopPlayId = this.playId;
        this.loopTimeout = setTimeout(() => {
            if (this.playId === loopPlayId && this.isPlaying && this.currentTrack === 1) this.playTrack1();
        }, loopTime - 100);
    }

    // --- track 2: digital heartbreak (95 bpm) ---
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
        
        // DRUMS - Half-time emotional feel
        for (let bar = 0; bar < 16; bar++) {
            const barStart = now + bar * 4 * beatTime;
            // Kick on 1
            this.playKick(barStart, 0.4);
            // Soft kick on 3 sometimes
            if (bar % 2 === 1) {
                this.playKick(barStart + 2 * beatTime, 0.25);
            }
            // Snare on 3 (half-time)
            this.playSnare(barStart + 2 * beatTime, 0.3);
            // Hi-hats on quarters
            for (let i = 0; i < 4; i++) {
                this.playHiHat(barStart + i * beatTime, 0.08);
            }
            // Open hat on beat 4
            this.playOpenHat(barStart + 3 * beatTime, 0.07);
            // Crash every 8 bars
            if (bar % 8 === 0) {
                this.playCrash(barStart, 0.12);
            }
        }
        
        const loopTime = 64 * beatTime * 1000;
        const loopPlayId = this.playId;
        this.loopTimeout = setTimeout(() => {
            if (this.playId === loopPlayId && this.isPlaying && this.currentTrack === 2) this.playTrack2();
        }, loopTime - 100);
    }

    // --- track 3: broken static (125 bpm) ---
    playTrack3() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 125;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // D minor - aggressive, punk energy - just the main riff looped
        const melody = [
            // Main aggressive riff - repeated
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['F', 5, 2], ['E', 5, 2], ['D', 5, 2],
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['Bb', 5, 2], ['A', 5, 2], ['G', 5, 2], ['D', 5, 2],
            // Repeat the riff
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['G', 5, 2], ['F', 5, 2], ['E', 5, 2], ['D', 5, 2],
            ['D', 5, 1], ['D', 5, 1], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['Bb', 5, 2], ['A', 5, 2], ['G', 5, 2], ['D', 5, 2]
        ];
        
        const bass = [
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['C', 2, 4], ['C', 2, 4],
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['C', 2, 4], ['C', 2, 4]
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
        for (let bar = 0; bar < 16; bar++) {
            for (let i = 0; i < 8; i++) {
                const noteIdx = i % arpPattern.length;
                const octave = (i % 2 === 0) ? 4 : 5;
                this.playArp(this.note(arpPattern[noteIdx], octave), now + (bar * 8 + i) * arpBeatTime, arpBeatTime * 0.6, 0.1);
            }
        }
        
        // DRUMS - Fast punk four-on-floor
        for (let bar = 0; bar < 16; bar++) {
            const barStart = now + bar * 4 * beatTime;
            // Kick on every beat (punk style)
            for (let i = 0; i < 4; i++) {
                this.playKick(barStart + i * beatTime, 0.48);
            }
            // Snare on 2 and 4
            this.playSnare(barStart + beatTime, 0.38);
            this.playSnare(barStart + 3 * beatTime, 0.38);
            // Hi-hats on 8ths - loud and driving
            for (let i = 0; i < 8; i++) {
                this.playHiHat(barStart + i * beatTime / 2, 0.14);
            }
            // Open hat accents
            this.playOpenHat(barStart + 1.5 * beatTime, 0.1);
            this.playOpenHat(barStart + 3.5 * beatTime, 0.1);
            // Crash every 4 bars
            if (bar % 4 === 0) {
                this.playCrash(barStart, 0.18);
            }
            // Tom fills
            if (bar === 7 || bar === 15) {
                this.playTom(barStart + 3 * beatTime, 180, 0.3);
                this.playTom(barStart + 3.25 * beatTime, 140, 0.3);
                this.playTom(barStart + 3.5 * beatTime, 110, 0.3);
                this.playTom(barStart + 3.75 * beatTime, 90, 0.3);
            }
        }
        
        const loopTime = 64 * beatTime * 1000;
        const loopPlayId = this.playId;
        this.loopTimeout = setTimeout(() => {
            if (this.playId === loopPlayId && this.isPlaying && this.currentTrack === 3) this.playTrack3();
        }, loopTime - 100);
    }

    // --- game over track ---
    playGameOverTrack() {
        if (!this.audioContext || !this.isPlaying) return;
        
        const tempo = 100;
        const beatTime = 60 / tempo;
        const now = this.audioContext.currentTime + 0.1;
        
        // D minor - dark and heavy
        const melody = [
            ['D', 5, 2], ['F', 5, 2], ['A', 5, 4],
            ['G', 5, 2], ['F', 5, 2], ['D', 5, 4],
            ['D', 5, 2], ['F', 5, 2], ['G', 5, 2], ['A', 5, 2],
            ['F', 5, 4], ['D', 5, 4],
            ['A', 5, 2], ['G', 5, 2], ['F', 5, 4],
            ['G', 5, 2], ['F', 5, 2], ['D', 5, 4],
            ['D', 5, 2], ['F', 5, 2], ['A', 5, 4],
            ['D', 5, 8]
        ];
        
        const bass = [
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['A', 1, 4], ['A', 1, 4],
            ['D', 2, 4], ['D', 2, 4], ['Bb', 1, 4], ['Bb', 1, 4],
            ['F', 2, 4], ['F', 2, 4], ['D', 2, 8]
        ];
        
        const arpPattern = ['D', 'A', 'D', 'F', 'A', 'D', 'F', 'A'];
        
        // Melody
        let time = 0;
        for (const [note, oct, beats] of melody) {
            this.playLead(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.85, 0.16);
            time += beats;
        }
        
        // Heavy bass
        time = 0;
        for (const [note, oct, beats] of bass) {
            this.playBass(this.note(note, oct), now + time * beatTime, beats * beatTime * 0.9, 0.5);
            time += beats;
        }
        
        // Arps
        const arpBeatTime = beatTime / 2;
        for (let bar = 0; bar < 14; bar++) {
            for (let i = 0; i < 8; i++) {
                const noteIdx = i % arpPattern.length;
                const octave = (i % 2 === 0) ? 4 : 5;
                this.playArp(this.note(arpPattern[noteIdx], octave), now + (bar * 8 + i) * arpBeatTime, arpBeatTime * 0.5, 0.06);
            }
        }
        
        // HEAVY DRUMS
        for (let bar = 0; bar < 14; bar++) {
            const barStart = now + bar * 4 * beatTime;
            // Kick on 1 and 3
            this.playKick(barStart, 0.55);
            this.playKick(barStart + 2 * beatTime, 0.55);
            // Extra kick on "and" of 2 for heaviness
            this.playKick(barStart + 1.5 * beatTime, 0.35);
            // Snare on 2 and 4
            this.playSnare(barStart + beatTime, 0.4);
            this.playSnare(barStart + 3 * beatTime, 0.4);
            // Hi-hats on 8ths
            for (let i = 0; i < 8; i++) {
                this.playHiHat(barStart + i * beatTime / 2, 0.12);
            }
            // Open hat
            this.playOpenHat(barStart + 3.5 * beatTime, 0.1);
            // Crash every 4 bars
            if (bar % 4 === 0) {
                this.playCrash(barStart, 0.18);
            }
        }
        
        const loopTime = 56 * beatTime * 1000;
        const loopPlayId = this.playId;
        this.loopTimeout = setTimeout(() => {
            if (this.playId === loopPlayId && this.isPlaying && this.currentTrack === 'gameover') this.playGameOverTrack();
        }, loopTime - 100);
    }

    // --- playback control ---
    
    // Kill ALL audio immediately by disconnecting musicGain and recreating it
    stop() {
        // INCREMENT PLAYID FIRST - this invalidates ALL pending loops and plays
        this.playId++;
        
        this.isPlaying = false;
        this.currentTrack = null;
        
        // Clear any pending play timeout
        if (this.playTimeout) {
            clearTimeout(this.playTimeout);
            this.playTimeout = null;
        }
        
        // Clear loop timeout
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
        }
        
        // NUCLEAR OPTION: Disconnect and recreate musicGain to kill ALL music instantly
        if (this.audioContext && this.musicGain) {
            this.musicGain.disconnect();
            this.musicGain = this.audioContext.createGain();
            this.musicGain.gain.value = 0.5;
            this.musicGain.connect(this.masterGain);
            
            try {
                const saved = localStorage.getItem('flapEmonadSettings');
                if (saved) {
                    const settings = JSON.parse(saved);
                    if (settings.musicVolume !== undefined) {
                        this.musicGain.gain.value = settings.musicVolume;
                    }
                }
            } catch (e) {}
        }
        
        this.activeNodes = [];
    }

    playTrack(trackNum) {
        this.init();
        this.stop();
        
        // Increment playId to invalidate any pending plays
        this.playId++;
        const thisPlayId = this.playId;
        const trackToPlay = trackNum;
        
        this.playTimeout = setTimeout(() => {
            // Only play if this is still the current play request
            if (this.playId !== thisPlayId) return;
            
            this.playTimeout = null;
            this.isPlaying = true;
            this.currentTrack = trackToPlay;
            switch(trackToPlay) {
                case 1: this.playTrack1(); break;
                case 2: this.playTrack2(); break;
                case 3: this.playTrack3(); break;
                default: this.playTrack1();
            }
        }, 50);
    }

    playMenuMusic() {
        // Menu always plays Track 3 (Broken Static) as theme song
        this.playTrack(3);
    }
    
    playGameMusic() {
        // In-game music is always random
        const trackNum = Math.floor(Math.random() * 3) + 1;
        this.playTrack(trackNum);
    }

    playGameOverMusic() {
        this.init();
        this.stop();
        
        // Increment playId to invalidate any pending plays
        this.playId++;
        const thisPlayId = this.playId;
        
        this.playTimeout = setTimeout(() => {
            // Only play if this is still the current play request
            if (this.playId !== thisPlayId) return;
            
            this.playTimeout = null;
            this.isPlaying = true;
            this.currentTrack = 'gameover';
            this.playGameOverTrack();
        }, 50);
    }

    playLeaderboardMusic() {
        this.playTrack(2);
    }

    stopMusic() {
        this.stop();
    }

    // --- sfx ---
    
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
