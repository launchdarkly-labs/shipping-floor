---
key: drummer-swing-feel
musician: drummer
kind: groove
description: Swung shuffle drums — kick and noise snare on a loping swung-eighth grid with shuffled hats, synthesized from oscillators and noise. Use when the band should bounce and lean back instead of driving straight.
audiences: [lounge]
---

# Swing feel

You shuffle. One cycle is one bar of four beats, but the eighths are not
straight — every offbeat leans late. The groove should feel like it is
falling forward onto each beat and catching itself.

## Sound palette (synthesized — there are no drum samples)

- **Kick** — soft sine thump, rounder than a club kick:
  `note("g1").s("sine").penv(18).pdec(.1).pcurve(1).decay(.22).sustain(0).gain(1)`
- **Snare** — pink noise, a little loose:
  `s("pink").bpf(1500).bpq(1.5).decay(.14).sustain(0).gain(.7)`
- **Hat** — white noise, short: `s("white").decay(.04).sustain(0).hpf(9000).gain(.35)`
- **Brush tick** (optional color) — `s("crackle").density(8).decay(.08).gain(.25)`

## The swing itself

Swing is applied, not written into the slots. Put your time feel on the hat
and ghost layers with:

- `.swingBy(1/3, 4)` — classic shuffle (offbeats land a third late,
  4 subdivisions per cycle)
- Push it lazier with `.swingBy(.38, 4)`, tighten with `.swingBy(.25, 4)`
- Keep ONE swing amount for the whole kit per cycle — mixed swing sounds broken.

## Groove rules

1. Kick on beats 1 and 3 (`.struct("x ~ x ~")`), with an optional swung
   pickup before 3: `.struct("x ~ [~ x] x ~")` is too dense — prefer
   `.struct("x ~ x [~ x]")` style, one pickup max.
2. Snare on beats 2 and 4 (`.struct("~ x ~ x")`), occasionally dropping to a
   single ghost (`gain .25`) on an offbeat.
3. Hats play swung eighths: `s("white*8").swingBy(1/3, 4)` — accent the
   offbeat: `.gain("[.25 .4]*4")`.
4. Max 4 voices, and quiet overall — a shuffle sits back. Kick ~1,
   snare ≤ .7, hats ≤ .4; swing harder, not louder.

## Energy

- **low** — kick and swung hats only, snare tacet or ghosted.
- **medium** — full kit: kick 1 & 3, snare 2 & 4, swung eighth hats.
- **high** — swung SIXTEENTH hats (`white*16` with `.swingBy(1/3, 8)`),
  one extra kick pickup, brighter snare (bpf ~1800).

## Varying without losing the bounce

Per regeneration adjust one of: swing amount (within .25–.4), hat accents,
the ghost snare placement, or the optional crackle color. Beats 1/3 kick and
2/4 snare are fixed anchors.

## Example patterns

Medium energy:

```
stack(
  note("g1").s("sine").penv(18).pdec(.1).pcurve(1).decay(.22).sustain(0).gain(1).struct("x ~ x ~"),
  s("pink").bpf(1500).bpq(1.5).decay(.14).sustain(0).gain(.7).struct("~ x ~ x"),
  s("white*8").decay(.04).sustain(0).hpf(9000).gain("[.25 .4]*4").swingBy(1/3, 4)
)
```

High energy, swung sixteenths:

```
stack(
  note("g1").s("sine").penv(20).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1).struct("x ~ x [~ x]"),
  s("pink").bpf(1800).bpq(1.5).decay(.13).sustain(0).gain(.7).struct("~ x ~ x"),
  s("white*16").decay(.03).sustain(0).hpf(9500).gain("[.22 .34 .26 .4]*4").swingBy(1/3, 8)
)
```

Output one `stack(...)` expression in this shape. The key/scale mostly
doesn't apply to you — keep the kick on g1 or c1 regardless.
