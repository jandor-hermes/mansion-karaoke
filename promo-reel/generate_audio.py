import math, random, struct, wave

SR = 44100
DURATION = 24.0
N = int(SR * DURATION)
rng = random.Random(20260915)
audio = [0.0] * N

def add_tone(start, duration, freq, amp, attack=0.01, release=0.12, wave_kind='sine'):
    a = int(start * SR)
    b = min(N, int((start + duration) * SR))
    for i in range(a, b):
        t = (i - a) / SR
        env = min(1.0, t / attack) if attack else 1.0
        remaining = duration - t
        if remaining < release:
            env *= max(0.0, remaining / release)
        phase = 2 * math.pi * freq * t
        if wave_kind == 'triangle':
            value = (2 / math.pi) * math.asin(math.sin(phase))
        else:
            value = math.sin(phase)
        audio[i] += amp * env * value

def add_kick(start, amp=0.55):
    a = int(start * SR)
    length = int(0.24 * SR)
    phase = 0.0
    for j in range(length):
        i = a + j
        if i >= N: break
        t = j / SR
        freq = 125 * math.exp(-t * 18) + 42
        phase += 2 * math.pi * freq / SR
        audio[i] += amp * math.exp(-t * 16) * math.sin(phase)

def add_noise(start, duration, amp, decay):
    a = int(start * SR)
    length = int(duration * SR)
    for j in range(length):
        i = a + j
        if i >= N: break
        t = j / SR
        audio[i] += amp * math.exp(-t * decay) * rng.uniform(-1, 1)

# 120 BPM party beat.
for beat in [x * 0.5 for x in range(int(DURATION / 0.5))]:
    add_kick(beat, 0.50 if int(beat * 2) % 4 in (0, 2) else 0.34)
    if int(beat * 2) % 4 in (1, 3):
        add_noise(beat, 0.15, 0.16, 22)
for eighth in [x * 0.25 for x in range(int(DURATION / 0.25))]:
    add_noise(eighth, 0.045, 0.055, 50)

# Bright synth-bass loop: C, Eb, F, G.
notes = [65.41, 77.78, 87.31, 98.00]
for bar_start in [x * 2.0 for x in range(12)]:
    root = notes[int(bar_start / 2) % len(notes)]
    for step in range(4):
        add_tone(bar_start + step * 0.5, 0.42, root, 0.13, attack=0.005, release=0.08, wave_kind='triangle')
        add_tone(bar_start + step * 0.5, 0.35, root * 2, 0.045, attack=0.005, release=0.08)

# Sparse hook melody for lift without competing with captions.
melody = [523.25, 622.25, 698.46, 783.99, 698.46, 622.25]
for phrase in (2.0, 10.0, 18.0):
    for idx, freq in enumerate(melody):
        add_tone(phrase + idx * 0.25, 0.20, freq, 0.055, attack=0.01, release=0.06)

# Fade in/out and normalize.
peak = max(abs(x) for x in audio) or 1.0
scale = 0.86 / peak
for i, value in enumerate(audio):
    t = i / SR
    fade = min(1.0, t / 0.35, (DURATION - t) / 0.7)
    audio[i] = max(-1.0, min(1.0, value * scale * max(0.0, fade)))

with wave.open('promo-reel/original-party-beat.wav', 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(SR)
    out.writeframes(b''.join(struct.pack('<h', int(x * 32767)) for x in audio))
