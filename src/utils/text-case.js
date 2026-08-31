// Changing the case of a piece of text. Nothing clever.

export const TEXT_CASES = {
  upper: (text) => String(text ?? '').toLocaleUpperCase(),
  lower: (text) => String(text ?? '').toLocaleLowerCase(),
  // First letter of each word up, everything else down.
  capitalize: (text) =>
    String(text ?? '')
      .toLocaleLowerCase()
      .replace(/(^|\P{L})(\p{L})/gu, (match, before, letter) => before + letter.toLocaleUpperCase()),
}

export const TEXT_CASE_MODES = Object.keys(TEXT_CASES)
