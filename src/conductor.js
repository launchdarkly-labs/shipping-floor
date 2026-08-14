import { EventEmitter } from 'node:events';

/**
 * The conductor is plain code — no LLM. It owns the musical ground truth
 * (tempo, key, scale) and the arrangement (sections), and it decides WHEN
 * each musician regenerates. Musicians decide WHAT to play — or rather,
 * LaunchDarkly's targeting rules do, keyed on the state this class publishes.
 *
 * Events:
 *   'cycle'   ({ cycle, section }) — every cycle boundary (approximate; the
 *             browser quantizes actual pattern swaps to its own audio clock)
 *   'section' ({ section })       — when the arrangement moves to a new section
 *   'regenerate' ({ musician, state }) — when a musician should generate a new pattern
 */
export class Conductor extends EventEmitter {
  constructor(config) {
    super();
    this.cps = config.tempo.cps;
    this.key = config.key;
    this.scale = config.scale;
    this.regenerateEvery = config.regenerateEveryCycles;
    this.settleAfterBoundaryCycles = config.settleAfterBoundaryCycles ?? 2;
    this.sections = config.sections;
    this.musicians = config.musicians;
    this.cycle = 0;
    this.sectionIndex = 0;
    this.sectionCycle = 0; // cycles elapsed within the current section
    this.settleAtCycle = null;
    this.timer = null;
  }

  get section() {
    return this.sections[this.sectionIndex];
  }

  /** Snapshot of everything a musician needs to know to generate a pattern. */
  stateFor(musician, { isBoundary = false } = {}) {
    const section = this.section;
    const next = this.sections[(this.sectionIndex + 1) % this.sections.length];
    return {
      key: this.key,
      scale: this.scale,
      cps: this.cps,
      cycle: this.cycle,
      section: section.name,
      energy: section.energy,
      isBoundary,
      cyclesLeftInSection: section.cycles - this.sectionCycle,
      nextSection: { name: next.name, energy: next.energy },
      playing: section.players.includes(musician),
      bandMembers: Object.keys(this.musicians),
    };
  }

  start() {
    if (this.timer) return;
    // Ask everyone for an opening pattern immediately so the show starts full.
    this.#briefEveryone({ isBoundary: true });
    this.settleAtCycle = this.cycle + this.settleAfterBoundaryCycles;
    const cycleMs = 1000 / this.cps;
    this.timer = setInterval(() => this.#tick(), cycleMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  #tick() {
    this.cycle += 1;
    this.sectionCycle += 1;

    let sectionChanged = false;
    if (this.sectionCycle >= this.section.cycles) {
      this.sectionIndex = (this.sectionIndex + 1) % this.sections.length;
      this.sectionCycle = 0;
      sectionChanged = true;
      this.emit('section', { section: this.section });
    }

    this.emit('cycle', { cycle: this.cycle, section: this.section });

    if (sectionChanged) {
      // A section change re-briefs the WHOLE band immediately with
      // isBoundary: true, so nobody plays through a breakdown they were never
      // told about — and so targeting can serve a moment variation.
      this.#briefEveryone({ isBoundary: true });
      this.settleAtCycle = this.cycle + this.settleAfterBoundaryCycles;
      return;
    }

    /**
     * Settle back off the moment.
     *
     * This is the boundary-hold fix, and it is the single most audible thing
     * in the refactor. A moment variation describes a ONE-CYCLE event — a
     * fill, a build, a drop — but patterns loop until something replaces
     * them, and the next replacement is governed by the stagger, not by the
     * boundary. At cps 0.5 with regenerateEveryCycles 8 and offsets 0/3/6
     * that is a 6-second hold for the bassist, 12 for the keys, and 16 for
     * the drummer: eight repeats of a one-bar drum fill designed to be heard
     * once.
     *
     * The old code solved this inside the musician, with a timer armed
     * whenever a moment skill happened to be loaded. Moving it here is
     * strictly better, because the musician no longer needs to know a moment
     * was ever loaded — it just gets briefed again with isBoundary: false,
     * and targeting serves the groove.
     */
    if (this.settleAtCycle === this.cycle) {
      this.settleAtCycle = null;
      this.#briefEveryone({ isBoundary: false });
      return;
    }

    for (const [musician, { regenerateOffset }] of Object.entries(this.musicians)) {
      if ((this.cycle - regenerateOffset) % this.regenerateEvery === 0) {
        this.emit('regenerate', { musician, state: this.stateFor(musician, { isBoundary: false }) });
      }
    }
  }

  #briefEveryone({ isBoundary }) {
    for (const musician of Object.keys(this.musicians)) {
      this.emit('regenerate', { musician, state: this.stateFor(musician, { isBoundary }) });
    }
  }
}
