#!/usr/bin/env python3
"""XOD evidence/usage gate, stdlib-only, read-only, safe on private local inputs.

This tool DOES NOT read ChatGPT usage telemetry or the user's Chrome/Drive data.
It accepts *explicitly observed and cited* measurements, validates them, and
outputs an aggregate report. No measurements => no fabricated progress/spend.
Public reports should be reviewed for privacy before uploading to GitHub.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import sys

SCHEMA = 1
VALID_GATES = {'PASS', 'FAIL', 'UNKNOWN'}
WEIGHTS = {'scope': 15, 'source': 15, 'source_tests': 20,
           'target_e2e': 25, 'measured_time_quota': 15, 'calibration': 10}

class InvalidEvidence(ValueError):
    pass


def number(value, name, low=0., high=100.):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise InvalidEvidence(f'{name}: expected finite number in [{low}, {high}]')
    return float(value)


def dt(value, name):
    if not isinstance(value, str):
        raise InvalidEvidence(f'{name}: ISO8601 timestamp required')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError('missing timezone')
        return parsed
    except (ValueError, TypeError) as e:
        raise InvalidEvidence(f'{name}: offset-aware ISO8601 timestamp required') from e


def evidence(obj, name):
    if not isinstance(obj, dict):
        raise InvalidEvidence(f'{name}: object required')
    ref = obj.get('evidence_ref')
    return isinstance(ref, str) and bool(ref.strip())


def gate_summary(payload):
    gates = payload.get('gates', [])
    if not isinstance(gates, list):
        raise InvalidEvidence('gates: array expected')
    if not gates:
        return {'result': 'UNKNOWN', 'progress_confirmed_pct': None,
                'progress_upper_bound_pct': None, 'required_total': 0,
                'mandatory_open': None, 'target_e2e_coverage': 0.}
    seen, total, confirmed, fail = set(), 0., 0., 0.
    open_count, e2e_weight = 0, 0.
    for g in gates:
        if not isinstance(g, dict) or not isinstance(g.get('id'), str) or not g['id'].strip():
            raise InvalidEvidence('gate id required')
        if g['id'] in seen:
            raise InvalidEvidence(f'duplicate gate id: {g["id"]}')
        seen.add(g['id'])
        w = number(g.get('weight'), f'gate {g["id"]} weight', .01, 1e6)
        status = g.get('status')
        if status not in VALID_GATES:
            raise InvalidEvidence(f'gate {g["id"]}: PASS, FAIL or UNKNOWN required')
        environment = g.get('environment', 'unknown')
        if environment not in {'target', 'source', 'simulated', 'unknown'}:
            raise InvalidEvidence(f'gate {g["id"]}: invalid environment')
        if status != 'UNKNOWN' and not evidence(g, g['id']):
            raise InvalidEvidence(f'gate {g["id"]}: PASS/FAIL requires evidence_ref')
        if not isinstance(g.get('mandatory', True), bool):
            raise InvalidEvidence(f'gate {g["id"]}: mandatory must be boolean')
        total += w
        is_target_pass = status == 'PASS' and environment == 'target' and evidence(g, g['id'])
        if is_target_pass:
            confirmed += w
            if g.get('e2e') is True:
                e2e_weight += w
        elif g.get('mandatory', True):
            open_count += 1
        # A failing target gate cannot be counted in the optimistic upper bound.
        if status == 'FAIL' and environment == 'target':
            fail += w
    lower = round(100 * confirmed / total, 1)
    upper = round(100 * (total - fail) / total, 1)
    return {'result': 'TARGET_ALL_PASS' if open_count == 0 else 'OPEN',
            'progress_confirmed_pct': lower, 'progress_upper_bound_pct': upper,
            'required_total': len(gates), 'mandatory_open': open_count,
            'target_e2e_coverage': e2e_weight / total}


def usage_summary(payload):
    items = payload.get('work_events', [])
    if not isinstance(items, list):
        raise InvalidEvidence('work_events: array expected')
    by_mode: dict[str, dict] = {}
    observed = missing = 0
    for i, ev in enumerate(items):
        if not isinstance(ev, dict):
            raise InvalidEvidence(f'work_events[{i}]: object required')
        mode = ev.get('mode')
        if not isinstance(mode, str) or not mode.strip():
            raise InvalidEvidence(f'work_events[{i}]: mode required; models do not share a quota by assumption')
        before, after = ev.get('before'), ev.get('after')
        if not (isinstance(before, dict) and isinstance(after, dict)):
            missing += 1
            continue
        a = dt(before.get('observed_at'), f'work_events[{i}].before.observed_at')
        b = dt(after.get('observed_at'), f'work_events[{i}].after.observed_at')
        if b < a:
            raise InvalidEvidence(f'work_events[{i}]: after precedes before')
        if ev.get('reset_between') is True:
            missing += 1
            continue
        if ev.get('reset_between') is not False:
            # Reset is unknown: do not treat a positive apparent delta as spending.
            missing += 1
            continue
        if not evidence(before, 'before') or not evidence(after, 'after'):
            missing += 1
            continue
        vals = {}
        for key in ('weekly_remaining_pct', 'five_hour_remaining_pct'):
            if key not in before or key not in after:
                continue
            start = number(before[key], f'before {key}')
            end = number(after[key], f'after {key}')
            if end > start:
                raise InvalidEvidence(f'work_events[{i}] {key}: increased despite declared no reset')
            vals[key] = round(start - end, 3)
        if not vals:
            missing += 1
            continue
        bucket = by_mode.setdefault(mode, {'weekly_used_pct': 0., 'five_hour_used_pct': 0., 'observations': 0})
        bucket['weekly_used_pct'] += vals.get('weekly_remaining_pct', 0.)
        bucket['five_hour_used_pct'] += vals.get('five_hour_remaining_pct', 0.)
        bucket['observations'] += 1
        observed += 1
    for bucket in by_mode.values():
        bucket['weekly_used_pct'] = round(bucket['weekly_used_pct'], 3)
        bucket['five_hour_used_pct'] = round(bucket['five_hour_used_pct'], 3)
    return {'mode_usage': by_mode, 'observed_events': observed, 'missing_or_reset_events': missing,
            'coverage': observed / len(items) if items else 0.}


def calibration_summary(payload):
    events = payload.get('estimates', [])
    if not isinstance(events, list):
        raise InvalidEvidence('estimates: array expected')
    groups: dict[str, list] = {}
    for i, x in enumerate(events):
        if not isinstance(x, dict):
            raise InvalidEvidence(f'estimates[{i}]: object required')
        group = x.get('comparable_group')
        if not isinstance(group, str) or not group.strip():
            raise InvalidEvidence(f'estimates[{i}]: comparable_group required')
        low = number(x.get('predicted_min'), f'estimates[{i}] predicted_min', 0, 1e9)
        high = number(x.get('predicted_max'), f'estimates[{i}] predicted_max', 0, 1e9)
        actual = number(x.get('actual'), f'estimates[{i}] actual', 0, 1e9)
        if high < low:
            raise InvalidEvidence(f'estimates[{i}]: inverted interval')
        if not evidence(x, f'estimates[{i}]'):
            raise InvalidEvidence(f'estimates[{i}]: source evidence_ref required')
        groups.setdefault(group, []).append((low, high, actual))
    out = {}
    for group, xs in groups.items():
        n = len(xs)
        median_errors = [abs(a - (lo + hi) / 2) for lo, hi, a in xs]
        out[group] = {'samples': n,
                      'interval_coverage_pct': round(100 * sum(lo <= a <= hi for lo, hi, a in xs) / n, 1) if n >= 3 else None,
                      'mean_abs_error': round(sum(median_errors) / n, 2) if n >= 3 else None,
                      'calibration_state': 'STILL_SMALL' if n < 3 else ('PRELIMINARY' if n < 10 else 'CHECKED_10_PLUS')}
    return out


def analyze(payload):
    if not isinstance(payload, dict) or payload.get('schema') != SCHEMA:
        raise InvalidEvidence('schema: expected 1')
    scope = payload.get('scope_version')
    if not isinstance(scope, str) or not scope.strip():
        raise InvalidEvidence('scope_version required')
    g = gate_summary(payload)
    u = usage_summary(payload)
    c = calibration_summary(payload)
    flags = payload.get('evidence', {})
    if not isinstance(flags, dict):
        raise InvalidEvidence('evidence must be object')
    evidence_weights = {}
    for k in ('scope', 'source', 'source_tests'):
        val = flags.get(k)
        evidence_weights[k] = 1 if val is not None and evidence(val, k) else 0
    evidence_weights['target_e2e'] = g['target_e2e_coverage']
    evidence_weights['measured_time_quota'] = u['coverage']
    # Merely getting 3 trials permits early calibration only; at >=10 trial samples,
    # the calibrated model has fuller evidence, but it is still not a prediction guarantee.
    best_n = max((x['samples'] for x in c.values()), default=0)
    evidence_weights['calibration'] = 0 if best_n < 3 else (.5 if best_n < 10 else 1.)
    idx = round(sum(WEIGHTS[k] * evidence_weights[k] for k in WEIGHTS), 1)
    accepted = (g['result'] == 'TARGET_ALL_PASS' and evidence_weights['scope'] == 1
                and g['required_total'] > 0 and g['target_e2e_coverage'] > 0)
    return {'schema': SCHEMA, 'scope_version': scope, 'gate_status': g['result'],
            'target_progress_confirmed_pct': g['progress_confirmed_pct'],
            'target_progress_upper_bound_pct': g['progress_upper_bound_pct'],
            'gates_total': g['required_total'], 'mandatory_gates_open': g['mandatory_open'],
            'release_gates_all_pass': accepted,
            'work_usage': u, 'calibration': c,
            'accuracy_evidence_index_pct': idx, 'accuracy_factors': evidence_weights,
            'accuracy_interpretation': 'evidence coverage, NOT empirical forecast probability',
            'cautions': ['No data in a field means UNKNOWN, not 0% spend or 100% ready',
                         'Source or simulated test PASS does not satisfy target acceptance',
                         'Work usage requires paired evidence and explicit no-reset statement',
                         'Tool validates structure, not external truth of evidence references']}


def self_test():
    b = {'schema': 1, 'scope_version': 'synthetic-test'}
    r = analyze(b)
    assert r['gate_status'] == 'UNKNOWN'
    assert r['target_progress_confirmed_pct'] is None
    assert r['work_usage']['observed_events'] == 0
    assert r['accuracy_evidence_index_pct'] == 0
    b['gates'] = [
        {'id': 'source', 'weight': 2, 'status': 'PASS', 'environment': 'simulated', 'evidence_ref': 'synthetic:source'},
        {'id': 'target', 'weight': 3, 'status': 'PASS', 'environment': 'target', 'e2e': True, 'evidence_ref': 'synthetic:host'},
        {'id': 'fails', 'weight': 1, 'status': 'FAIL', 'environment': 'target', 'evidence_ref': 'synthetic:failure'},
        {'id': 'unknown', 'weight': 2, 'status': 'UNKNOWN', 'environment': 'unknown'},
    ]
    r = analyze(b)
    assert (r['target_progress_confirmed_pct'], r['target_progress_upper_bound_pct']) == (37.5, 87.5)
    assert not r['release_gates_all_pass']
    # All target PASS without a single real E2E gate must not become release-ready.
    no_e2e = {'schema': 1, 'scope_version': 'synthetic-test',
              'evidence': {'scope': {'evidence_ref': 'synthetic:approved'}},
              'gates': [{'id': 'only-target-unit', 'weight': 1, 'status': 'PASS',
                         'environment': 'target', 'evidence_ref': 'synthetic:target-unit'}]}
    assert analyze(no_e2e)['release_gates_all_pass'] is False
    no_e2e['gates'][0]['e2e'] = True
    assert analyze(no_e2e)['release_gates_all_pass'] is True
    b['work_events'] = [
        {'mode': 'WORK_SOL', 'reset_between': False,
         'before': {'observed_at': '2026-11-22T12:00:00+03:00', 'weekly_remaining_pct': 80.,
                    'five_hour_remaining_pct': 50., 'evidence_ref': 'synthetic:before'},
         'after': {'observed_at': '2026-11-22T13:00:00+03:00', 'weekly_remaining_pct': 76.,
                   'five_hour_remaining_pct': 42., 'evidence_ref': 'synthetic:after'}},
        {'mode': 'WORK_SOL', 'reset_between': True,
         'before': {'observed_at': '2026-11-22T14:00:00+03:00', 'weekly_remaining_pct': 20.},
         'after': {'observed_at': '2026-11-29T14:00:00+03:00', 'weekly_remaining_pct': 90.}}]
    r = analyze(b)
    assert r['work_usage']['mode_usage']['WORK_SOL']['weekly_used_pct'] == 4
    assert r['work_usage']['mode_usage']['WORK_SOL']['five_hour_used_pct'] == 8
    assert r['work_usage']['missing_or_reset_events'] == 1
    assert r['accuracy_evidence_index_pct'] == 16.9
    b['work_events'][0]['after']['weekly_remaining_pct'] = 81
    try: analyze(b)
    except InvalidEvidence: pass
    else: raise AssertionError('reset-like increase was accepted')
    b['work_events'][0]['after']['weekly_remaining_pct'] = 76
    b['gates'][0]['evidence_ref'] = ''
    try: analyze(b)
    except InvalidEvidence: pass
    else: raise AssertionError('evidence-free PASS was accepted')
    print('SELF_TEST_PASS: no-data, weighted acceptance, simulated exclusion, quota delta, reset exclusion, bad-increase, missing-evidence')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', help='Local JSON with actual evidence; NEVER publish private input')
    p.add_argument('--output', help='Local output JSON report; privacy-review before sharing')
    p.add_argument('--self-test', action='store_true', help='Synthetic unit tests only')
    p.add_argument('--empty-template', action='store_true', help='Print blank example for an executor')
    a = p.parse_args()
    if a.self_test:
        self_test(); return 0
    if a.empty_template:
        print(json.dumps({'schema': 1, 'scope_version': 'xod-3.0-v1', 'evidence': {},
                          'gates': [], 'work_events': [], 'estimates': []}, indent=2)); return 0
    if not a.input: p.error('--input required unless --self-test or --empty-template')
    try:
        report = analyze(json.loads(Path(a.input).read_text(encoding='utf-8')))
    except (OSError, json.JSONDecodeError, InvalidEvidence) as e:
        print(json.dumps({'status': 'BLOCKED', 'reason': str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2
    out = json.dumps(report, indent=2, ensure_ascii=False)+'\n'
    if a.output: Path(a.output).write_text(out, encoding='utf-8')
    print(out)
    return 0

if __name__ == '__main__':
    sys.exit(main())
