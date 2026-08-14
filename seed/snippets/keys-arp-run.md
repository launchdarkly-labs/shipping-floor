---
key: keys-arp-run
musician: keys
kind: moment
description: A one-bar rising arpeggio flourish that opens a high-energy section — fast, bright, delay-tailed, sweeping up the scale across the downbeat you just landed on. Load ONLY at the boundary INTO a high-energy section (never mid-section, never into a quiet one); you return to your groove immediately after.
audiences: [peak-hour]
---

# Arp run

This is a ONE-CYCLE event on the downbeat of a high-energy section you just
entered. You throw a sparkler over its first bar: a fast arpeggio that
starts low, sweeps upward, and clears the way for the groove. Next cycle
you are back on your groove.

## Sound

Bright plucked sawtooth with a delay tail:

```
.s("sawtooth").lpf(2200).lpq(3).attack(.003).decay(.12).sustain(0).gain(.45).delay(".35:.375:.5").room(.3)
```

- Brighter than a stab (`lpf` 1800–2600) but still gain ≤ .5.
- Notes very short (`decay` ≤ .15) — the delay provides the wash.

## Run rules

1. **Ascend.** Scale degrees rising over the bar, e.g. sixteenths:
   `n("0 2 4 6 7 9 11 13 14 13 11 9 7 6 4 2")` is a peak-and-return;
   a pure climb `n("0 2 4 6 7 9 11 14")` on eighths is just as good.
2. Stay inside the conductor's scale, octave 3–4 (degrees 0 to ~16 from
   octave 3). No chromatic notes.
3. One melodic voice only — no chords during the run (the delay thickens it).
4. Optionally open the filter as you climb: `.lpf(saw.range(1400,2600))`.
5. End the bar clean: the last note lands on a chord tone (degree 0, 2, or
   4 family) so the arrival section starts consonant.

## Example runs

Sixteenth climb with opening filter:

```
n("0 2 4 6 7 9 11 13 14 13 14 16 14 11 9 7").scale("A3:minor").s("sawtooth").lpf(saw.range(1400,2600)).lpq(3).attack(.003).decay(.11).sustain(0).gain(.45).delay(".35:.375:.5")
```

Eighth-note climb, more space:

```
n("0 2 4 7 9 11 14 16").scale("A3:minor").s("sawtooth").lpf(2200).lpq(3).attack(.003).decay(.13).sustain(0).gain(.45).delay(".35:.375:.5").room(.3)
```

Output a single expression: one rising bar. Use the conductor's key and
scale, never hardcode a different root.
