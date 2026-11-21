import json
import unittest
from cache_state_diagnostics import assert_cache_state_unchanged, changed_json_paths


class CacheAssertionTests(unittest.TestCase):
    def test_equal_is_pass(self):
        assert_cache_state_unchanged('[{"updatedAt":100},{"groups":[]},[]]', '[{"updatedAt":100},{"groups":[]},[]]')

    def test_timestamp_is_not_ignored(self):
        with self.assertRaisesRegex(AssertionError, '/0/updatedAt') as error:
            assert_cache_state_unchanged('[{"updatedAt":100}]', '[{"updatedAt":200}]',
                                         {'dirty':False,'saving':False,'updatedAt':100},
                                         {'dirty':False,'saving':True,'updatedAt':200})
        self.assertIn('save-state before=', str(error.exception))
        self.assertNotIn('"updatedAt":200', str(error.exception))

    def test_nested_personal_data_not_leaked(self):
        with self.assertRaises(AssertionError) as error:
            assert_cache_state_unchanged(json.dumps([{'items':[{'text':'SECRET_REAL_BOARD'}]}]),
                                         json.dumps([{'items':[{'text':'SECRET_MODIFIED'}]}]))
        self.assertIn('/0/items/0/text', str(error.exception))
        self.assertNotIn('SECRET_', str(error.exception))

    def test_added_removed_keys_are_visible(self):
        differences,_=changed_json_paths({'a':1,'b':2},{'b':2,'c':3})
        self.assertEqual([p[0] for p in differences], ['/a','/c'])
        self.assertEqual(differences[0][3], 'missing')

    def test_pointers_escape_special_keys(self):
        diffs,_ = changed_json_paths({'a/b~c':1},{'a/b~c':2})
        self.assertEqual(diffs[0][0],'/a~1b~0c')

    def test_order_only_changes_still_fail(self):
        with self.assertRaisesRegex(AssertionError,'Structural values equal'):
            assert_cache_state_unchanged('{"a":1,"b":2}', '{"b":2,"a":1}')

    def test_max_changes_is_enforced(self):
        differences,truncated=changed_json_paths(list(range(100)),[x+1 for x in range(100)],max_changes=3)
        self.assertEqual(len(differences),3)
        self.assertTrue(truncated)

    def test_array_new_element(self):
        diff,_=changed_json_paths([1],[1,2])
        self.assertEqual(diff[0][0], '/1')
        self.assertEqual(diff[0][1], 'missing')

    def test_types_not_coerced(self):
        diff,_=changed_json_paths({'ok':True},{'ok':1})
        self.assertEqual((diff[0][1],diff[0][3]),('boolean','number'))

    def test_no_sensitive_values_in_malformed_json_error(self):
        with self.assertRaises(AssertionError) as e:
            assert_cache_state_unchanged('SECRET_{','OTHER_SECRET_}')
        self.assertNotIn('SECRET',str(e.exception))

    def test_snapshot_null_to_value(self):
        diff,_=changed_json_paths({'pal':None},{'pal':[]})
        self.assertEqual((diff[0][1],diff[0][3]),('null','array'))

    def test_negative_depth_and_cap_rejected(self):
        with self.assertRaises(ValueError):changed_json_paths(1,2,max_changes=0)
        with self.assertRaises(ValueError):changed_json_paths(1,2,max_depth=0)


if __name__ == '__main__': unittest.main()
