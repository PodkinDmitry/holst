"""Wait for a quiescent XOD persistence baseline before cache-cleanup assertions.

This is deliberately test-only; it never changes app state or suppresses the
subsequent byte-exact after-cleanup assertion. No board content is logged.
"""

STATE_JSON = "JSON.stringify([S.board, S.org, LS.get('pal28')])"
SAVE_PROBE = "({dirty:!!dirty,saving:!!saving,saveAgain:!!saveAgain})"


def wait_for_cache_baseline(ev, pause, *, attempts=6, settle_ms=1050):
    """Return a stable (serialized_state, save_probe), or fail closed.

    The source XOD autosave delay tops out at 900 ms. settle_ms must exceed
    this configured debounce interval. `pause` is page.wait_for_timeout in E2E;
    test doubles are accepted for deterministic unit tests.

    We sample both sides of a quiet interval; if either sample is saving/dirty,
    or JSON changes between them, we retry. Repeated instability is a test FAIL,
    never a skipped invariant.
    """
    if attempts < 1 or settle_ms <= 900:
        raise ValueError('positive attempts and settle_ms > XOD 900ms debounce required')
    last = None
    for _ in range(attempts):
        before_state = ev(STATE_JSON)
        before_probe = ev(SAVE_PROBE)
        pause(settle_ms)
        after_state = ev(STATE_JSON)
        after_probe = ev(SAVE_PROBE)
        if not isinstance(before_state, str) or not isinstance(after_state, str):
            raise AssertionError('cache preflight JSON unavailable')
        if not isinstance(before_probe, dict) or not isinstance(after_probe, dict):
            raise AssertionError('cache preflight save status unavailable')
        keys = ('dirty', 'saving', 'saveAgain')
        if any(type(probe.get(k)) is not bool for probe in (before_probe, after_probe) for k in keys):
            raise AssertionError('cache preflight save status malformed')
        busy = any(probe[k] for probe in (before_probe, after_probe) for k in keys)
        if before_state == after_state and not busy:
            return after_state, after_probe
        last = ('busy' if busy else 'state-changed')
    raise AssertionError('cache preflight remained unstable after '
                         f'{attempts} intervals: {last}; no state was accepted')
