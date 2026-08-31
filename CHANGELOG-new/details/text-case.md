# Change Case

## Goal

Three buttons in the selection bar. Press one, the selected text becomes upper case, lower case, or
capitalized. Nothing else.

## Behaviour

```
evaluating cnn model trade-off (edge)
  UPPERCASE   ->  EVALUATING CNN MODEL TRADE-OFF (EDGE)
  lowercase   ->  evaluating cnn model trade-off (edge)
  Capitalize  ->  Evaluating Cnn Model Trade-Off (Edge)
```

Capitalize puts the first letter of each word up and the rest down, which is what the word is normally
taken to mean. An earlier attempt left the rest of each word untouched so that acronyms survived; that
was cleverness the user had not asked for, and an application that guesses does the unexpected.

With nothing selected the command does nothing and reports it.

## The one part that is not simple

The text is replaced run by run, back to front, rather than wholesale. Replacing a whole selection
would drop every mark inside it - bold, links, colour, font - and rewriting front to back would shift
the positions of the runs still to come. A bold word stays bold through all three changes.

## Tests

- `tests/unit/text-case.test.mjs`, 7 checks on the transforms themselves.
- `tests/e2e/text-case.cdp.mjs`, 11 checks, pressing the real buttons in the selection bar and
  confirming a bold run survives each one.

```bash
npm run test:unit:text-case
npm run test:e2e:text-case
```
