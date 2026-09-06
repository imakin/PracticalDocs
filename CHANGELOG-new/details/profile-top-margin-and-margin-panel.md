# A Profile's Top Margin, and What the Margin Panel Shows

## Goal

A profile's Top Margin moves the block, the way its Bottom Margin already did. The margin panel in the
Home toolbar shows the spacing the block actually has, not an empty field.

## Fault one: the top margin was outranked

A profile is a CSS rule, so whether it applies is a question about the cascade. Three rules set
`margin-top` on a block. Measured in Chrome on a paragraph carrying `profile-paragraph`:

```
.pdoc-editor-content .pdoc-editor > * + *:not(.pdoc-floating-node)   var(--pdoc-content-node-bottom)   (0,3,0)
.pdoc-editor-container p, ul, ol                                   0px                              (0,1,1)
[data-pdoc-profile-styles="..."] .pdoc-profile-paragraph            5em                              (0,2,0)
```

The first wins on specificity. `--pdoc-content-node-bottom` resolves to `0`, so a profile's Top Margin
was set to zero at every value, and the rule's only remaining effect was to suppress it.

Bottom Margin worked because nothing competes for `margin-bottom`. The container reset sets
`margin: 0`, which covers both, but at `(0,1,1)` it loses to the profile's `(0,2,0)` - which is why
one half of the same field worked and the other did nothing.

The gap between blocks is a default, so the rule now says so with `:where()` and scores nothing:

```less
:where(& > * + *:not(.pdoc-floating-node)) {
  margin-top: var(--pdoc-content-node-bottom);
}
```

A profile that states a top margin now wins. A block without one still takes the gap. Nothing moves
on screen today, because the variable is `0`; a host that sets it non-zero would find paragraphs
falling back to the container reset's `0`, which is the one behaviour this trades away.

## Fault two: the panel only knew about overrides

`setMarginValue` in `margin.vue` read `node.attrs.margin` and nothing else. Since ADR 0007 made a
profile the block's CSS class, a block styled only by its profile carries no margin attribute at all,
so the panel opened blank on a block that plainly had spacing - and would keep doing so however many
margin bugs were fixed underneath it.

The panel now also reads the block's profile and shows its values **as the placeholder**:

```
Top:     [                    ]  profile: 5em
Bottom:  [                    ]  profile: 3em
```

Placeholder, not value, on purpose. The field means "an override this block carries". Seeding it with
the profile's value would make the next keystroke - or a re-entered identical value - write a
per-block override the user did not ask for, turning styling the profile owns into an inline style.
That is the exact confusion ADR 0007 was written to end. With an override set, the override is the
value and the profile stays visible underneath it.

The Bottom Margin preset buttons highlight against the effective value, so the active preset shows
whether it came from the profile or from an override.

## Tests

`profile-margins.cdp.mjs`, 13 checks, its own fixture. It measures computed pixels on the rendered
block, at two different `em` values so a single lucky number cannot pass it, and checks that a block
whose profile states no top margin still takes the editor default. It opens the real margin panel by
pressing its own arrow handle, so the selectors the panel depends on are covered.

```bash
npm run test:e2e:profile-margins
```

Seen to fail on the unpatched build first: 5 of the 13 red - the top margin computing `0px` at both
values, and all three placeholder checks. The two override checks stay green in both directions,
which is the control: a per-block override always worked and must keep working.

One of those placeholder checks passed spuriously at first, because it used `includes('5em')` and the
old placeholder read `e.g. 0.25em, 12px` - which contains `5em` inside `0.25em`. It compares the whole
string now.
