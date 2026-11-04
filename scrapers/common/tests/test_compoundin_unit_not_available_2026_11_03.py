"""compoundin: a unit whose own card on its compound page says «Not available» is GONE (2026-11-03).

CIN810 (dur-alhada) sat at 24 strikes, shown: the page keeps the withdrawn unit's card with the ribbon
«Not available» and no «Inquire Now» button, so the crawl (keyed by the button) skipped it and the
oracle had no opinion. Measured live: 810 ribbon + no button; 809/811/812 button + no ribbon."""
from scrapers.compoundin import run as R


def _card(uid: str, *, ribbon: bool, button: bool) -> str:
    rib = '<span class="cin-unit-card__ribbon">Not available</span>' if ribbon else ""
    btn = (f'<button class="btn cin-unit-card__inquire-btn" data-cin-open-contact-modal '
           f'data-cin-contact-unit="{uid}"> Inquire Now </button>') if button else ""
    return (f'<article class="cin-compound-card cin-unit-card" id="unit-{uid}">'
            f'<div class="cin-compound-card__media"> {rib} </div>'
            f'<h3 class="cin-unit-card__title">Villa</h3> {btn} </article>')


PAGE = ('<html><h1>Dur Alhada</h1><section class="cin-property-units">'
        + _card("809", ribbon=False, button=True) + _card("810", ribbon=True, button=False)
        + _card("811", ribbon=False, button=True) + '</section>'
        # the contact modal lists every unit id, available or not — never evidence of life
        + '<input type="radio" name="unit_id" value="810"></html>')


def test_a_unit_marked_not_available_is_gone():
    assert R._unit_signal("810")(200, PAGE, False) == "gone"


def test_an_available_unit_is_live():
    assert R._unit_signal("809")(200, PAGE, False) == "live"
    assert R._unit_signal("811")(200, PAGE, False) == "live"


def test_a_unit_absent_from_the_page_has_no_opinion():
    assert R._unit_signal("999")(200, PAGE, False) is None


def test_a_ribboned_card_is_never_live_even_with_a_button():
    page = PAGE.replace(_card("810", ribbon=True, button=False), _card("810", ribbon=True, button=True))
    assert R._unit_signal("810")(200, page, False) == "gone"
    assert R._unit_signal("810")(200, page, True) is None      # a redirect elsewhere decides nothing


def test_the_ribbon_belongs_to_its_own_card_only():
    assert not R.unit_marked_not_available(PAGE, "809")
    assert R.unit_marked_not_available(PAGE, "810")
