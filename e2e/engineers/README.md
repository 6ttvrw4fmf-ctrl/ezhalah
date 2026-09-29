# Engineer test tools

Browser and data tools the nightly engineers (docs/ops/*_ENGINEER.md) reuse from run to run, so no
run spends its hour rebuilding them. The ⚡ Scraping Engineer saves its live-site full-chain browser
test here the first time it writes one (for example `full-chain.mjs`), and every later run reuses it.
Tools here are read-only against production: they search the live site and read data through the
public anon key, never write.

## customer-cards.mjs: search like a customer, read the cards, click some

```
node e2e/engineers/customer-cards.mjs --city الرياض --deal rent --type شقة [--district النرجس] [--more] [--open 3] [--mobile] [--out cards.json]
```

- Drives production the way a person does, reusing the live sweep's proven steps
  (`e2e/live-sweep/sweep.mjs`): deal, city, district (optional), the type's group and type chip,
  then «بحث». `--more` presses «عرض المزيد» until it's gone (10 → 100 → 500 cards on a big search).
  `--mobile` uses a phone-size screen (iPhone 13), as the rulebooks ask; the default is desktop.
- Writes JSON (default `$TMPDIR/customer-cards.json`) with every card in on-screen order: `platform`,
  `title`, `district`, `price`, `href` (the link the card opens) and `ref` (`table:id`). It also
  records the request the app sent (`sent`) and the results headline count.
- `--open N` clicks the first N cards like a user. For each one it records the URL the app opened,
  where the new tab landed (`landed_url`), that landing's HTTP `status`, and `moved: true` when it
  landed somewhere other than the card's link (a homepage or search page means a dead ad).
- Prints one summary line and exits 0. Exits 2 when it can't drive the search (city, district or
  type not offered, or the search didn't settle). Hard cap: 20 minutes.
- Read-only. Clicking a card makes the app insert a paid-click row, so the tool blocks every write
  to a database table (`blocked_writes` counts them). The cards still open normally.
- **Alive or dead:** the listing websites block the cloud, so judge the original pages through the
  proxy. Feed the `ref` values (`jq -r '[.cards[].ref] | join(",")' cards.json`, or `.opened[].ref`
  for the clicked ones) as `ids` to `source-reread.yml` (`scrapers/common/source_reread.py`) or
  `lifecycle-spot-check.yml` (`scrapers/common/lifecycle_spot_check.py`, one website's `platform` per
  run) for alive/dead verdicts.
