---
key: drummer-fill-transition
musician: drummer
kind: moment
description: A one-bar drum fill that marks a section change — snare rolls and tom runs that break the groove for exactly one cycle and land hard on the downbeat of the new section. The all-purpose boundary marker: load at any section boundary, and prefer it for boundaries that are NOT into a high-energy section (a build-up fits those better). Load ONLY at a boundary; you return to your groove immediately after.
audiences: [peak-hour, lounge]
---

# Fill transition

This is a ONE-CYCLE event, not a feel. You are crossing from one section
into the next: break your groove for a single bar, build tension across it,
and make the last hit throw the band onto the new section's downbeat. Next
cycle you will be back on your groove skill.

## Sound palette (synthesized — there are no drum samples)

- **Synth toms** — sines with a moderate pitch drop, pitched to fall:
  `note("g2 e2 c2").s("sine").penv(14).pdec(.12).pcurve(1).decay(.25).sustain(0).gain(.9)`
- **Snare roll** — white noise bursts, tightening:
  `s("white").bpf(1800).bpq(2).decay(.09).sustain(0)`
- Keep your groove's kick sound available for anchor hits (beat 1, maybe beat 3):
  `note("c1").s("sine").penv(24).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1.1)`

## Fill rules

1. **Keep beat 1** — open the bar with a kick anchor so the fill reads as
   part of the song, then let the fill take over the second half of the bar.
2. Classic shapes (pick ONE per fill):
   - **Snare build**: eighth → sixteenth acceleration,
     `.struct("~ ~ ~ ~ x ~ x ~ x x x x x x x x")` with rising gains
     `.gain("0 0 0 0 .3 0 .35 0 .4 .45 .5 .55 .6 .65 .7 .75")`
   - **Tom run**: descending tom line in the last half:
     `note("~ ~ ~ ~ ~ g2 e2 c2").s("sine").penv(14).pdec(.12).pcurve(1)`
   - **Chop-and-drop**: cut everything except kick+snare hits on odd
     sixteenths, leaving dramatic holes.
3. The final sixteenth may be a single loud snare or a silence — both throw
   the downbeat. Never end with a wash of noise.
4. 3 voices max. Snare peaks ≤ .8, toms ≤ .9.

## Example fills

Snare build into the drop:

```
stack(
  note("c1").s("sine").penv(24).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1.1).struct("x ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"),
  s("white*16").bpf(1800).bpq(2).decay(.08).sustain(0).gain("0 0 0 0 .3 0 .35 0 .4 .45 .5 .55 .6 .65 .7 .78")
)
```

Tom run:

```
stack(
  note("c1").s("sine").penv(24).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1.1).struct("x ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"),
  s("white").bpf(1700).decay(.09).sustain(0).gain(.6).struct("~ ~ ~ ~ x ~ ~ x ~ ~ ~ ~ ~ ~ ~ ~"),
  note("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ g2 ~ e2 ~ c2 c2").s("sine").penv(14).pdec(.12).pcurve(1).decay(.25).sustain(0).gain(.85)
)
```

Output one `stack(...)` expression: one bar of fill built on your groove's
sound palette. Key/scale mostly doesn't apply — toms live on c2/e2/g2.
