# Engineer test tools

Browser and data tools the nightly engineers (docs/ops/*_ENGINEER.md) reuse from run to run, so no
run spends its hour rebuilding them. The ⚡ Scraping Engineer saves its live-site full-chain browser
test here the first time it writes one (for example `full-chain.mjs`), and every later run reuses it.
Tools here are read-only against production: they search the live site and read data through the
public anon key, never write.
