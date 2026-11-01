"""Haraj masks long digit runs as a phone number, which can cut the deed's map link in half (2026-10-22).

Live ad 18482433 (شقة، حي الملقا، الرياض) carries the link twice in its text: the deed block's copy reads
«…?q=24.802963812807,46.( رقم الجوال يظهر عند الضغط على زر تواصل )» and a later copy is whole. The reader
took the cut copy, rejected it, and never looked at the whole one, so the ad showed a district border.
"""
from scrapers.haraj.parse import full_pin

CUT = "موقع العقار على الخريطة: https://maps.google.com/?q=24.802963812807,46.( رقم الجوال يظهر عند الضغط على زر تواصل )"
WHOLE = "موقع العقار على الخريطة: https://maps.google.com/?q=24.802963812807,46.597182495004"


def test_a_cut_link_is_not_a_pin():
    assert full_pin(CUT) is None


def test_the_whole_copy_is_read_when_the_first_is_cut():
    assert full_pin(CUT + " … " + WHOLE) == ["24.802963812807", "46.597182495004"]


def test_a_coarse_pair_is_not_a_pin():
    assert full_pin("https://maps.google.com/?q=24,46") is None
    assert full_pin("https://maps.google.com/?q=24.8,46.5") is None
