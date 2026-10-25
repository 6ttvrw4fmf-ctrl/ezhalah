"""The facts word checker's own self-check (real tricky phrases from the 2026-10-24 LLM test report) runs on
every scraper PR: negation, prepared-only, nearby, «غرفة كهرباء», «شارع ٢٥», corner plots, PDPL."""
from scrapers.facts import word_checker


def test_word_checker_selftest():
    word_checker.selftest()
