---
key: bassist-sub-drop
musician: bassist
kind: moment
description: A one-bar sub-bass drop that lands on the downbeat of a new section — one huge low note with a falling pitch tail, then space. Load ONLY at a section boundary you are crossing into a high-energy or driving section (not when easing down into a quiet one); you return to your groove immediately after.
audiences: [peak-hour]
---

# Sub drop

This is a ONE-CYCLE event. A new section just landed (or is landing) and
you mark it with one enormous low hit — the note everyone feels in their
chest — then get out of the way. Next cycle you are back on your groove.

## Sound

A pure sine an octave below your usual register, with a slow pitch fall
and a long decay:

```
n("0").scale("A0:minor").s("sine").penv(-12).pdec(.8).pcurve(1).attack(.005).decay(1.2).sustain(.1).release(.3).gain(.9).lpf(300)
```

- Octave 0 — one octave below your groove register.
- `penv` NEGATIVE (the pitch falls, it never rises). Between -7 and -14.
- `lpf` ≤ 350. This is felt more than heard.

## Drop rules

1. **One hit on beat 1.** At most add a quiet echo of it on beat 3
   (`gain ≤ .4`). The rest of the bar is space — resist filling it.
2. Root only: degree 0 of the conductor's scale (or -7 for even lower).
   No lines, no movement — this is punctuation, not a phrase.
3. Never exceed gain .9, and keep `sustain` low so the tail decays before
   the next cycle starts.

## Example drops

The classic — one hit and silence:

```
n("0").scale("A0:minor").s("sine").penv(-10).pdec(.8).pcurve(1).attack(.005).decay(1.2).sustain(.1).release(.3).gain(.9).lpf(300)
```

With a ghost echo on beat 3:

```
n("0 ~ 0 ~").scale("A0:minor").s("sine").penv(-10).pdec(.7).pcurve(1).decay(1).sustain(.05).gain(".9 0 .35 0").lpf(300)
```

Output a single expression: one bar, one felt low note, then space. Use the
conductor's key and scale for the root, never hardcode a different one.
