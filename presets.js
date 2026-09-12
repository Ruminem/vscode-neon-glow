'use strict';
/**
 * Three ways to have it, for someone who has just installed this and is looking
 * at twenty-three numbers.
 *
 * Data only, with no reference to the editor, so the checks can read the same
 * object the command applies rather than scraping it back out of the source.
 * An earlier version of that check read the word "here" out of a comment and
 * reported it as a setting, which is what scraping gets you.
 *
 * "Default" is deliberately not a list of values. It clears the keys instead,
 * which leaves settings.json without a Neon Glow section at all - so the next
 * release that moves a default moves it for everyone who picked this, rather
 * than for everyone except them. A preset that writes the defaults out longhand
 * quietly pins them forever.
 *
 * A knob a preset does not name is cleared rather than left alone, so picking a
 * preset twice in a row lands in the same place whatever was set in between.
 * That is why the chroma curve can be left out of all three: minChroma and the
 * rest decide which token colours glow at all, which is a different question
 * from how loud the result is, and clearing them is the right answer to it.
 */

const PRESETS = {
  subtle: {
    label: 'Subtle',
    icon: '$(lightbulb)',
    detail: 'The same surfaces, turned down. Nothing moves.',
    values: {
      brightness: 0.7, glowLayers: 2, maxBlur: 26,
      findGlow: 12, selectionGlow: 8, occurrenceGlow: 6, gutterGlow: 6,
      bracketMatchGlow: 6, squiggleGlow: 4, diffGlow: 6,
      lineHighlightGlow: 5, breakpointGlow: 5,
      cursorTrail: 0, saveShake: 0, breathe: 0, caretArc: 'off',
    },
  },

  default: {
    label: 'Default',
    icon: '$(discard)',
    detail: 'Clear every Neon Glow setting and use what ships.',
    values: null,
  },

  everything: {
    label: 'Everything on',
    icon: '$(zap)',
    detail: 'Every glow, and the movement too.',
    values: {
      brightness: 1, glowLayers: 3, maxBlur: 36,
      findGlow: 18, selectionGlow: 12, occurrenceGlow: 10, gutterGlow: 8,
      bracketMatchGlow: 10, squiggleGlow: 5, diffGlow: 10,
      lineHighlightGlow: 8, breakpointGlow: 8,
      cursorTrail: 45, saveShake: 5, breathe: 2400,
      caretArc: 'arc', caretArcMinJump: 5, caretArcDuration: 300,
      /* Left off on purpose even here: a drag moves the caret at mouse rate and
         draws an arc per step, which reads as noise rather than as the effect. */
      caretArcOnDrag: false,
    },
  },
};

/** The order they are offered in: quietest, back to shipped, loudest. */
const PRESET_ORDER = ['subtle', 'default', 'everything'];

module.exports = { PRESETS, PRESET_ORDER };
