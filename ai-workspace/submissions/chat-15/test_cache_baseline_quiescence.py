import unittest
from cache_baseline_quiescence import (
    SAVE_PROBE, STATE_JSON, wait_for_cache_baseline,
)

IDLE = {'dirty': False, 'saving': False, 'saveAgain': False}
BUSY = {'dirty': True, 'saving': False, 'saveAgain': False}


def runner(intervals):
    """Fake the exact alternation: JSON, probe, pause, JSON, probe."""
    calls = []
    counter = iter(intervals)
    current = None

    def evaluate(expr):
        nonlocal current
        calls.append(expr)
        if expr == STATE_JSON:
            current = next(counter)
            return current[0]
        if expr == SAVE_PROBE:
            return current[1]
        raise AssertionError('unexpected expression')

    def pause(ms):
        calls.append(('pause', ms))

    return evaluate, pause, calls


class BaselineTests(unittest.TestCase):
    def test_stable_accepts_without_mutating_app(self):
        ev, wait, calls = runner([('"same"', IDLE), ('"same"', IDLE)])
        self.assertEqual(wait_for_cache_baseline(ev, wait)[0], '"same"')
        self.assertEqual(calls.count(('pause', 1050)), 1)

    def test_waits_for_pending_debounce_and_save(self):
        ev, wait, calls = runner([
            ('"before"', BUSY), ('"after"', IDLE),
            ('"after"', IDLE), ('"after"', IDLE)])
        self.assertEqual(wait_for_cache_baseline(ev, wait)[0], '"after"')
        self.assertEqual(calls.count(('pause', 1050)), 2)

    def test_changed_json_in_quiet_interval_requires_retry(self):
        ev, wait, calls = runner([
            ('{"updatedAt":1}', IDLE), ('{"updatedAt":2}', IDLE),
            ('{"updatedAt":2}', IDLE), ('{"updatedAt":2}', IDLE)])
        self.assertEqual(wait_for_cache_baseline(ev, wait)[0], '{"updatedAt":2}')
        self.assertEqual(calls.count(('pause', 1050)), 2)

    def test_fails_closed_when_status_always_busy(self):
        ev, wait, _ = runner([('"a"', BUSY), ('"a"', IDLE)] * 2)
        with self.assertRaisesRegex(AssertionError, 'remained unstable'):
            wait_for_cache_baseline(ev, wait, attempts=2)

    def test_fails_closed_when_json_never_settles(self):
        ev, wait, _ = runner([('"a"', IDLE), ('"b"', IDLE)] * 2)
        with self.assertRaisesRegex(AssertionError, 'state-changed'):
            wait_for_cache_baseline(ev, wait, attempts=2)

    def test_rejects_unbounded_or_short_stabilization(self):
        ev, wait, _ = runner([])
        for opts in ({'attempts':0}, {'settle_ms':900}, {'settle_ms':1}):
            with self.subTest(opts=opts), self.assertRaises(ValueError):
                wait_for_cache_baseline(ev, wait, **opts)

    def test_invalid_save_probe_cannot_look_idle(self):
        ev, wait, _ = runner([('"a"', {'dirty':'false', 'saving':False,'saveAgain':False}),('"a"', IDLE)])
        with self.assertRaisesRegex(AssertionError, 'malformed'):
            wait_for_cache_baseline(ev, wait)

    def test_payload_cannot_appear_in_fail_message(self):
        secret='private-board-CONTENT-1234'
        ev, wait, _=runner([(secret, IDLE),(secret+'x',IDLE)])
        try:
            wait_for_cache_baseline(ev,wait, attempts=1)
        except AssertionError as e:
            self.assertNotIn(secret,str(e))
            self.assertIn('state-changed',str(e))
        else:
            self.fail('must reject changed state')


if __name__ == '__main__':
    unittest.main()
