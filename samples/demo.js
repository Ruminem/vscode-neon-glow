// The file the README clip is recorded on. Not shipped in the VSIX.
//
// Every line in it is doing a job. The hex strings give the glow something
// saturated to work with and give VS Code its colour chips; the caret is parked
// after a call, which lights the matching bracket box and every other place
// that symbol appears; and the three lines at the bottom carry an error, a
// warning and an info, so the squiggles are real ones rather than drawn on.
//
// For diffGlow, change a word here and open the file from source control: that
// opens a diff, which is the one view the gutter's change bars are missing from.

const PALETTE = ['#F92672', '#A6E22E', '#66D9EF'];

function glow(level) {
  const strength = level * 1.5 + 0.25;
  return PALETTE.map((colour) => ({ colour, strength }));
}

const warm = glow(0.75);
const cool = glow(0.25);

undefinedHelper(warm);
const unusedForNow = cool;
glow(1);
