# The Profiles List Chooses; The Edit Dialog Sets

## Goal

The Profiles dialog's list is where a profile is found and opened. It does nothing else.

## What was wrong

Every row carried a numbering switch. A profile's numbering could be turned on or off from a list
whose whole purpose is choosing which profile to look at - the setting changed without the thing it
belongs to ever being opened, and with none of the context that makes it a sensible thing to change.

The edit dialog already had the same switch, next to every other decision the profile makes. So the
list's copy was a second control for one setting, in the place where it made least sense.

## What changed

- The switch is gone from the list. `toggleProfileEnabled` went with it; nothing else called it.
- **The state stays visible.** A profile with numbering off says `numbering off` in its details line,
  beside the target type, style and template it already showed. Removing a control should not remove
  the fact - a list that cannot tell you which profiles are numbered is worse than one that can.
- The switch in the edit dialog is untouched, and is now the only one.

## Tests

`profiles-dialog.cdp.mjs`, 7 checks, its own fixture. It opens the real dialog by pressing the block
gallery's arrow and then its Manage Profiles bar, so the selectors both depend on are covered.

```bash
npm run test:e2e:profiles-dialog
```

It counts switches in the list, which must be none, and requires every row to keep its actions. It
reads the details line of a profile whose numbering was turned off beforehand and requires it to say
so, and the line of one that is numbered and requires it not to. Then it opens that profile for
editing and requires exactly one switch, **showing off** - tied to the profile's actual state rather
than to a label, because a switch that reflects nothing would pass a label check and mislead a reader.

Seen to fail on the unpatched build first: the list reports a switch on every row, and the details line
says nothing about numbering.
