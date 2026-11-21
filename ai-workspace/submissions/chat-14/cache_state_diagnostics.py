"""Strict XOD JSON-state assertion with bounded, non-disclosing structural diagnostics.

Reports JSON paths, value types and truncated SHA-256 digests, never the values.
A mismatch remains a failure, even if a JSON object was merely re-ordered.
"""
from __future__ import annotations
import hashlib
import json
from collections.abc import Mapping

_MISSING = object()


def _digest(value):
    if value is _MISSING:
        return 'missing'
    b = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')
    return hashlib.sha256(b).hexdigest()[:12]


def _kind(value):
    if value is _MISSING:
        return 'missing'
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, dict):
        return 'object'
    return type(value).__name__


def _key_segment(key):
    # JSON-pointer escape, so keys cannot masquerade as a hierarchy.
    return str(key).replace('~', '~0').replace('/', '~1')


def changed_json_paths(before, after, max_changes=40, max_depth=64):
    """Return changed paths/type/hash only; duplicates and long data are bounded."""
    if max_changes < 1 or max_depth < 1:
        raise ValueError('bounds must be positive')
    out = []
    stack = [('', before, after, 0)]
    while stack and len(out) < max_changes:
        path, left, right, depth = stack.pop()
        if left is right and left is not _MISSING:
            continue
        # Never mistake 1 == True or 1 == 1.0 for byte-identical JSON.
        if type(left) is type(right) and not isinstance(left, (dict, list)) and left == right:
            continue
        if depth >= max_depth:
            out.append((path or '/', _kind(left), _digest(left), _kind(right), _digest(right)))
        elif isinstance(left, dict) and isinstance(right, dict):
            keys = sorted(set(left) | set(right), key=str, reverse=True)
            stack.extend((path + '/' + _key_segment(key),
                          left.get(key, _MISSING), right.get(key, _MISSING), depth+1)
                         for key in keys)
        elif isinstance(left, list) and isinstance(right, list):
            stack.extend((path + '/' + str(i),
                          left[i] if i < len(left) else _MISSING,
                          right[i] if i < len(right) else _MISSING,
                          depth+1)
                         for i in range(max(len(left), len(right)) - 1, -1, -1))
        else:
            out.append((path or '/', _kind(left), _digest(left), _kind(right), _digest(right)))
    return out, bool(stack)


def assert_cache_state_unchanged(before_json, after_json, before_probe=None, after_probe=None):
    """Match the original byte-level assertion, adding safe diagnostics on failure.

    Probe values are synthetic diagnostics from the browser (saving/timer state),
    never original board contents. The assertion intentionally never auto-waits or
    suppresses differences in updatedAt or another field.
    """
    if before_json == after_json:
        return
    try:
        before, after = json.loads(before_json), json.loads(after_json)
        changed, truncated = changed_json_paths(before, after)
    except (ValueError, TypeError, RecursionError) as exc:
        raise AssertionError('Cache cleanup changed JSON state (parse failure: '
                             + type(exc).__name__ + ')') from exc
    lines = ['Cache cleanup changed the exact serialized board/org/palette state.']
    if changed:
        for path, atype, ahash, btype, bhash in changed:
            lines.append(f'{path}: {atype}:{ahash} -> {btype}:{bhash}')
        if truncated:
            lines.append('... truncated to 40 changed paths')
    else:
        lines.append('Structural values equal; serialized JSON ordering/representation changed.')
    if before_probe is not None or after_probe is not None:
        # Diagnostics is allowlisted; no board content, only booleans and timestamps.
        keys = ('updatedAt', 'dirty', 'saving', 'saveAgain', 'timerPending')
        def safe(p):
            if not isinstance(p, Mapping):
                return None
            return {k: p.get(k) for k in keys if k in p and
                    (k != 'updatedAt' or isinstance(p.get(k), (int, float, type(None))))}
        lines.append('save-state before=' + repr(safe(before_probe)) + ' after=' + repr(safe(after_probe)))
    raise AssertionError('\n'.join(lines))
