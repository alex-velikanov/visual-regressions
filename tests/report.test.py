"""Exercise report.py with judge severities that are not JSON integers: unreadable ones are re-judged, never taken as 0."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPORT = Path(sys.argv.pop(1)).resolve() / 'report.py'


class SeverityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def read(self, name):
        return json.loads((self.root / name).read_text())

    def run_report(self, mode, expected=0):
        result = subprocess.run([sys.executable, str(REPORT), mode], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def test_merge_normalizes_before_blank_and_suspect_checks(self):
        records = [{'file': str(i), 'severity': value, 'seen': 'page'}
                   for i, value in enumerate(['4', None, 'bad', {}, [], 2.9, float('inf')])]
        records.append({'file': 'missing', 'seen': 'page'})
        self.write('raw_report.1.txt', records)
        self.write('changed.json', [r['file'] for r in records])
        self.write('diffs.json', {r['file']: 60 for r in records})
        self.run_report('merge')
        self.assertEqual([r['severity'] for r in self.read('first.json')], [4, 0, 0, 0, 0, 2, 0, 0])
        suspects = {x['file']: x['reason'] for x in self.read('suspects.json')}
        self.assertEqual(len(suspects), 7)
        for f in ['1', '2', '3', '4', '6', 'missing']:       # None, 'bad', {}, [], inf, and no severity at all
            self.assertIn('unreadable severity', suspects[f], f)
        self.assertNotIn('unreadable', suspects['5'])         # 2.9 is a readable severity that was passed on a 60% diff
        self.assertNotIn('0', suspects)                       # '4' is readable and already fails
        self.run_report('final', 1)
        self.write('blank.json', ['0', '1'])
        self.run_report('merge')
        self.assertEqual([r['severity'] for r in self.read('first.json')][:2], [5, 5])
        self.assertEqual([r['judge_severity'] for r in self.read('first.json')[:2]], [4, 0])

    def test_recheck_normalizes_and_never_lowers(self):
        for value, expected in [('4', 4), ('1', 2), (None, 2), ('bad', 2), ({}, 2), ([], 2), (float('inf'), 2)]:
            with self.subTest(value=value):
                self.write('raw_report.1.txt', [{'file': 'page', 'severity': '2'}])
                self.write('changed.json', ['page'])
                self.run_report('merge')
                self.write('recheck.1.txt', [{'file': 'page', 'severity': value}])
                self.run_report('final', int(expected >= 3))
                record = self.read('report.json')[0]
                self.assertEqual(record['severity'], expected)
                self.assertEqual(record['first_severity'], 2)
                if value in (None, 'bad', {}, [], float('inf')):
                    self.assertTrue(any('unreadable severity' in w['warning'] for w in self.read('warnings.json')))

    def test_missing_first_verdict_uses_normalized_recheck(self):
        self.write('raw_report.1.txt', [])
        self.write('changed.json', ['page'])
        self.run_report('merge')
        self.write('recheck.1.txt', [{'file': 'page', 'severity': '3'}])
        self.run_report('final', 1)
        self.assertEqual(self.read('report.json')[0]['severity'], 3)

    def test_unreadable_first_severity_takes_a_readable_recheck(self):
        for value in [None, 'high', 7, -1, True, {}, 'nan']:
            with self.subTest(value=value):
                self.write('raw_report.1.txt', [{'file': 'page', 'severity': value, 'seen': 'a page'}])
                self.write('changed.json', ['page'])
                self.run_report('merge')
                self.assertIn('unreadable severity', self.read('suspects.json')[0]['reason'])
                self.write('recheck.1.txt', [{'file': 'page', 'severity': 4, 'seen': 'broken'}])
                self.run_report('final', 1)
                record = self.read('report.json')[0]
                self.assertEqual((record['severity'], record['first_severity']), (4, None))

    def test_unreadable_everywhere_is_warned_about_not_silently_passed(self):
        self.write('raw_report.1.txt', [{'file': 'page', 'severity': 'high', 'seen': 'a page'}])
        self.write('changed.json', ['page'])
        self.run_report('merge')
        self.write('recheck.1.txt', [{'file': 'page', 'severity': 'critical'}])
        self.run_report('final')
        warnings = [w['warning'] for w in self.read('warnings.json')]
        self.assertTrue(any('re-check gave an unreadable severity' in w for w in warnings), warnings)
        self.write('recheck.1.txt', 'no json here')
        self.run_report('final')
        warnings = [w['warning'] for w in self.read('warnings.json')]
        self.assertTrue(any('nothing usable' in w and 'unreadable severity' in w for w in warnings), warnings)

    def test_numeric_strings_in_any_numeric_form_are_read_the_same_way_everywhere(self):
        for value, expected in [('3.0', 3), ('1e0', 1), (' 4 ', 4), ('4', 4), (3.9, 3), ('0.0', 0), ('5', 5)]:
            with self.subTest(value=value):
                self.write('raw_report.1.txt', [{'file': 'page', 'severity': value, 'seen': 'a page'}])
                self.write('changed.json', ['page'])
                self.write('diffs.json', {'page': 1})
                self.run_report('merge')
                self.assertEqual(self.read('suspects.json'), [])          # readable, so not a suspect
                self.assertEqual(self.read('first.json')[0]['severity'], expected)   # and read as that number, not 0
                self.run_report('final', int(expected >= 3))
                self.assertEqual(self.read('report.json')[0]['severity'], expected)

    def test_readable_severities_are_not_suspects(self):
        for value in [0, 2, 3, 5, '4', 2.9, 0.0]:
            with self.subTest(value=value):
                self.write('raw_report.1.txt', [{'file': 'page', 'severity': value, 'seen': 'a page'}])
                self.write('changed.json', ['page'])
                self.write('diffs.json', {'page': 1})
                self.run_report('merge')
                self.assertEqual(self.read('suspects.json'), [])


if __name__ == '__main__':
    unittest.main()
