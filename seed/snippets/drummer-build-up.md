---
key: drummer-build-up
musician: drummer
kind: moment
description: A one-bar surge that launches a high-energy section — accelerating noise hits and a rising filter that erupt on the downbeat of the section you just entered. Load ONLY at the boundary INTO a high-energy section (never mid-section, never easing down into a quiet one); you return to your groove immediately after.
audiences: [peak-hour]
---

# Build-up

This is a ONE-CYCLE event on the downbeat of a high-energy section you just
entered. Across this one bar density rises and the filter opens, so the
section erupts into life rather than merely starting. Next cycle you are
back on your plain groove.

## Sound palette (synthesized — there are no drum samples)

- **Riser bed** — white noise swelling as the bar runs:
  `s("white*16").decay(.05).sustain(0).hpf(saw.range(4000,12000)).gain(saw.range(.15,.5))`
- **Accelerating snare** — noise hits doubling in rate:
  `s("pink").struct("x ~ ~ ~ x ~ ~ ~ x ~ x ~ x x x x").bpf(1600).decay(.08).sustain(0)`
- **Kick anchors** — keep sparse kicks so the floor doesn't vanish:
  `note("c1").s("sine").penv(24).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1.05).struct("x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~")`

## Build rules

1. **Rise in density or pitch across the bar** — use `saw.range(a,b)` on
   gain or filter cutoff so the sweep spans exactly the one cycle.
2. Keep quarter-note kicks underneath: the build must stay danceable.
3. **Leave the last sixteenth empty** (`~`) — the silence right before the
   drop is the loudest thing in the bar.
4. 3 voices max. The riser bed peaks ≤ .5; the accelerating snare ≤ .7.

## Example build

```
stack(
  note("c1*4").s("sine").penv(24).pdec(.09).pcurve(1).decay(.2).sustain(0).gain(1.05),
  s("white*16").decay(.05).sustain(0).hpf(saw.range(4000,12000)).gain(saw.range(.15,.48)),
  s("pink").struct("x ~ ~ ~ x ~ ~ ~ x ~ x ~ x x x ~").bpf(1600).decay(.08).sustain(0).gain(saw.range(.3,.7))
)
```

Output one `stack(...)` expression: one bar of rising tension. Key/scale
mostly doesn't apply — keep the kick on c1.
