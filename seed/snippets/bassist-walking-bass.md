---
key: bassist-walking-bass
musician: bassist
kind: groove
description: Stepwise walking bass — four smooth quarter notes per cycle that walk through the conductor's scale, targeting chord tones on the strong beats. Use for a rounder, jazzier pulse under swung or breakbeat drums, or when the section calls for restraint.
audiences: [lounge, peak-hour]
---

# Walking bass

You walk. One cycle is one bar of four beats, and you place one smooth note
on each beat, connecting them by step so the line always sounds like it is
going somewhere.

## Sound

Round and woody — a triangle wave with a soft filter, longer than a house
pluck but never droning:

```
.s("triangle").lpf(900).decay(.3).sustain(.25).release(.1).gain(.85)
```

Keep this timbre. Your expression lives in note choice, not sound design.

## Pitch rules

- Choose pitches as scale degrees: `n("...").scale("<root>1:<scale>")` from
  the conductor's key/scale, octave 1 or 2.
- **Strong beats (1 and 3) land on chord tones**: degrees 0, 2, or 4.
- **Weak beats (2 and 4) connect by step**: move to a neighboring degree
  (±1) or chromatic approach of the next strong beat's target.
- Never leap more than 4 degrees at once, and follow any leap with a step
  back in the opposite direction.
- Start each cycle on degree 0 or its octave (7, or -7 below).

## Groove rules

1. Default rhythm is four quarter notes: `n("0 1 2 4")` — one note per beat,
   no rests in the middle of the line.
2. A pair of eighths as a pickup into beat 1 or 3 is allowed once per cycle:
   `n("0 1 2 [3 4]")`.
3. One voice only. No chords, no octaved doubling.
4. Register: stay in the two octaves around degree 0 (degrees -7 to 9).

## Energy

- **low** — half notes: two notes per cycle (`n("0 4")`), let them ring
  (`sustain(.4)`).
- **medium** — the classic quarter-note walk.
- **high** — quarter walk plus one eighth-note pickup pair, slightly brighter
  filter (~1100), a touch more gain.

## Varying without losing the walk

Each regeneration, walk a different path to the same anchors: change the
passing tones, invert the direction (descend to the octave below via -1 -2
-3), or shift where the eighth-note pickup lands. Keep beats 1 and 3 on
chord tones every time.

## Example patterns

Medium energy, ascending then turning back:

```
n("0 1 2 1").scale("A1:minor").s("triangle").lpf(900).decay(.3).sustain(.25).gain(.85)
```

Descending line with a pickup into the next cycle:

```
n("7 5 4 [2 1]").scale("A1:minor").s("triangle").lpf(900).decay(.3).sustain(.25).gain(.85)
```

Output a single expression in this shape. Use the conductor's key and scale,
never hardcode a different root.
