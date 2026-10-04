"""Tests for html_report.py: no browser, no model. Run: python3 html_report.test.py <path to vr/>"""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

SCRIPT = Path(sys.argv.pop(1)).resolve() / 'html_report.py'


def write_png(path, w=8, h=6, rgb=(200, 200, 200)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def put(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def images(self, filename, kinds=('baseline', 'current', 'diff')):
        for k in kinds:
            write_png(self.root / k / filename)

    def run_report(self, url='https://shop.example.com/'):
        env = dict(os.environ, VR_REPORT_URL=url, PYTHONDONTWRITEBYTECODE='1')
        r = subprocess.run([sys.executable, str(SCRIPT)], cwd=self.root, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return (self.root / 'report' / 'index.html').read_text(encoding='utf-8')

    def scenario(self):
        files = ['mobile__pricing__0.png', 'desktop__home__0.png', 'desktop__home__1.png', 'tablet__new__0.png',
                 'mobile__gone__0.png', 'desktop__nov__0.png', 'desktop__size__0.png']
        for f in ['mobile__pricing__0.png', 'desktop__home__0.png', 'desktop__home__1.png', 'desktop__nov__0.png']:
            self.images(f)
        self.images('tablet__new__0.png', ('current',))
        self.images('mobile__gone__0.png', ('baseline',))
        self.images('desktop__size__0.png', ('baseline', 'current'))
        self.put('changed.json', files)
        self.put('report.json', [
            {'file': 'mobile__pricing__0.png', 'verdict': 'fail', 'severity': 5, 'seen': 'a 500 page',
             'findings': [{'what': 'Server error', 'where': 'whole page', 'confidence': 'high'}]},
            {'file': 'desktop__home__0.png', 'verdict': 'fail', 'severity': '3', 'findings': []},
            {'file': 'desktop__home__1.png', 'verdict': 'pass', 'severity': 0, 'seen': 'the footer', 'findings': []},
            {'file': 'tablet__new__0.png', 'verdict': 'pass', 'severity': 1, 'findings': []},
            {'file': 'desktop__size__0.png', 'verdict': 'pass', 'severity': 2, 'findings': []},
        ])
        self.put('warnings.json', [{'file': 'desktop__home__1.png', 'warning': '60% of pixels differ but the judge gave severity 0.'}])
        self.put('diffs.json', {'mobile__pricing__0.png': 52.1, 'desktop__home__1.png': 60})

    def test_sections_order_and_banner(self):
        self.scenario()
        page = self.run_report()
        self.assertIn('FAIL', page)
        self.assertIn('2 of 7 changed screenshots at severity 3 or above (worst: 5)', page)
        self.assertIn('2 have no usable verdict from the judge', page)
        i_fail, i_look, i_other = page.index('Failed (2)'), page.index('Needs a look ('), page.index('Other changes (')
        self.assertLess(i_fail, i_look)
        self.assertLess(i_look, i_other)
        self.assertLess(page.index('mobile · pricing · screen 1'), page.index('desktop · home · screen 1'))   # severity 5 before 3
        failed_part = page[i_fail:i_look]
        self.assertIn('mobile__pricing__0.png', failed_part)
        self.assertIn('desktop__home__0.png', failed_part)
        look_part = page[i_look:i_other]
        for f in ['desktop__home__1.png', 'desktop__nov__0.png', 'mobile__gone__0.png']:   # a warning, or no verdict
            self.assertIn(f, look_part)
        self.assertIn('60% of pixels differ but the judge gave severity 0.', look_part)
        self.assertIn('No usable verdict', look_part)
        other_part = page[i_other:]
        self.assertIn('tablet__new__0.png', other_part)
        self.assertIn('desktop__size__0.png', other_part)

    def test_images_are_copied_and_linked_relatively(self):
        self.scenario()
        page = self.run_report()
        for kind in ('baseline', 'current', 'diff'):
            self.assertTrue((self.root / 'report' / 'img' / kind / 'mobile__pricing__0.png').is_file(), kind)
            self.assertIn(f'src="img/{kind}/mobile__pricing__0.png"', page)
        self.assertFalse((self.root / 'report' / 'img' / 'baseline' / 'tablet__new__0.png').exists())
        self.assertIn('Only in the current run', page)
        self.assertIn('Only in the baseline', page)
        self.assertIn('differ in size, so there is no pixel diff', page)
        self.assertNotIn('http://', page.replace('http://www.w3.org', ''))      # nothing is loaded from elsewhere

    def test_everything_the_judge_wrote_is_escaped_and_there_is_no_script(self):
        self.images('desktop__home__0.png')
        self.images('a"b__x__0.png')
        self.put('changed.json', ['desktop__home__0.png', 'a"b__x__0.png'])
        evil = '<script>alert(1)</script> "><img src=x onerror=alert(2)> & <b>'
        self.put('report.json', [
            {'file': 'desktop__home__0.png', 'verdict': evil, 'severity': 4, 'seen': evil,
             'findings': [{'what': evil, 'where': evil, 'confidence': evil}, evil], 'rechecked': evil},
            {'file': 'a"b__x__0.png', 'verdict': 'fail', 'severity': 4, 'findings': []},
        ])
        self.put('warnings.json', [{'file': 'desktop__home__0.png', 'warning': evil}])
        page = self.run_report(url=evil)
        low = page.lower()
        self.assertNotIn('<script', low)
        self.assertNotIn('<img src=x', low)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', page)
        self.assertEqual(low.count('<img '), 3)                  # only the report's own images: 3 for the safe file
        self.assertIn('a&quot;b__x__0.png', page)                # an unsafe name is shown escaped ...
        self.assertNotIn('a%22b', page)                          # ... but never used as an image path
        self.assertNotIn('src="img/current/a"b', page)
        self.assertIn('unsafe file name', page)

    def test_long_text_is_cut(self):
        self.images('desktop__home__0.png')
        self.put('changed.json', ['desktop__home__0.png'])
        self.put('report.json', [{'file': 'desktop__home__0.png', 'severity': 4, 'seen': 'x' * 5000, 'findings': []}])
        page = self.run_report()
        self.assertNotIn('x' * 2100, page)
        self.assertIn('x' * 2000, page)

    def test_notes_about_rechecks_unreadable_severities_and_blank_pages(self):
        for f in ['desktop__a__0.png', 'desktop__b__0.png', 'desktop__c__0.png']:
            self.images(f)
        self.put('changed.json', ['desktop__a__0.png', 'desktop__b__0.png', 'desktop__c__0.png'])
        self.put('report.json', [
            {'file': 'desktop__a__0.png', 'severity': 4, 'seen': 's', 'findings': [], 'rechecked': 'the judge did not say what it saw', 'first_severity': 0},
            {'file': 'desktop__b__0.png', 'severity': 0, 'seen': 's', 'findings': [], 'severity_raw': 'high'},
            {'file': 'desktop__c__0.png', 'severity': 5, 'findings': [], 'judge_severity': None},
        ])
        page = self.run_report()
        self.assertIn('Re-checked on its own (the judge did not say what it saw); first severity: 0.', page)
        self.assertIn('unreadable severity: &quot;high&quot;', page)
        self.assertIn('Forced to severity 5 because the page went blank (it gave no verdict)', page)

    def test_no_report_and_nothing_changed(self):
        self.assertIn('No report', self.run_report())              # an empty folder: the run never got that far
        self.put('changed.json', [])
        self.put('report.json', [])
        self.assertIn('Nothing changed', self.run_report())
        (self.root / 'report.json').unlink()
        self.put('changed.json', ['desktop__home__0.png'])
        self.images('desktop__home__0.png')
        page = self.run_report()
        self.assertIn('No report', page)
        self.assertIn('desktop__home__0.png', page)

    def test_a_rerun_replaces_the_folder_and_survives_odd_input(self):
        self.scenario()
        self.run_report()
        self.assertTrue((self.root / 'report' / 'img' / 'current' / 'mobile__pricing__0.png').exists())
        self.put('changed.json', ['desktop__home__0.png'])
        self.put('report.json', ['not an object', {'file': 'desktop__home__0.png', 'severity': None, 'findings': 'oops'}])
        self.put('warnings.json', 'nonsense')
        self.put('diffs.json', [])
        self.run_report()
        self.assertFalse((self.root / 'report' / 'img' / 'current' / 'mobile__pricing__0.png').exists())

    def test_pass_banner_when_nothing_is_severe(self):
        self.images('desktop__home__0.png')
        self.put('changed.json', ['desktop__home__0.png'])
        self.put('report.json', [{'file': 'desktop__home__0.png', 'severity': 2, 'seen': 's', 'findings': []}])
        page = self.run_report()
        self.assertIn('PASS', page)
        self.assertNotIn('Failed (', page)

    def test_unreadable_severity_cannot_make_a_pass_without_an_incomplete_flag(self):
        self.put('changed.json', ['page.png'])
        for value in [None, 'high', True, {}, [], -1, 7, 'nan', float('inf')]:
            with self.subTest(value=value):
                self.put('report.json', [{'file': 'page.png', 'severity': value}])
                page = self.run_report()
                self.assertIn('INCOMPLETE', page)
                self.assertIn('No usable verdict', page)
                self.assertNotIn('PASS', page)


    def test_unreadable_judge_replies_are_shown_as_text_and_the_run_is_not_a_pass(self):
        self.put('changed.json', ['desktop__home__0.png', 'mobile__home__0.png'])
        self.images('desktop__home__0.png')
        self.put('judge_errors.json', [{'file': 'raw_report.1.txt', 'reply': 'I could not open <script>alert(1)</script> the images'},
                                       {'file': 'raw_report.2.txt', 'reply': 'y' * 5000}])
        page = self.run_report()
        self.assertIn('NO VERDICT', page)
        self.assertIn('2 of the judge', page)
        self.assertIn('Replies that could not be read (2)', page)
        self.assertIn('I could not open &lt;script&gt;alert(1)&lt;/script&gt; the images', page)
        self.assertNotIn('<script>', page)
        self.assertLess(page.count('y'), 2200)                       # long replies are cut
        self.assertEqual(page.count('class="card'), 2)               # both changed files still shown, with their images
        self.assertIn('img/baseline/desktop__home__0.png', page)
        self.assertNotIn('PASS', page)

    def test_a_private_page_says_it_was_not_sent_to_the_judge_and_still_fails(self):
        self.put('changed.json', ['desktop__account__0.png'])
        self.images('desktop__account__0.png')
        self.put('report.json', [{'file': 'desktop__account__0.png', 'verdict': 'fail', 'severity': 3, 'judge_skipped': True,
                                  'findings': [{'what': 'This page is behind a login and is not sent to the judge', 'where': 'entire page', 'confidence': 'high'}]}])
        page = self.run_report()
        self.assertIn('FAIL', page)
        self.assertIn('Not sent to the judge: this page is behind a login', page)
        self.assertEqual(page.count('class="card fail'), 1)
        self.assertNotIn('No usable verdict', page)

    def test_malformed_judge_errors_are_ignored(self):
        self.put('changed.json', ['desktop__home__0.png'])
        for value in [{'a': 1}, 'text', [1, 'x', None], [{'file': 'f', 'reply': 7}]]:
            with self.subTest(value=value):
                self.put('judge_errors.json', value)
                page = self.run_report()
                self.assertNotIn('PASS', page)

    def test_a_symlinked_screenshot_is_never_copied(self):
        outer = self.root / 'outer'
        work = outer / 'vr'
        work.mkdir(parents=True)
        (outer / 'secret.png').write_text('TOP SECRET')
        for kind in ('baseline', 'current'):
            (work / kind).mkdir()
            (work / kind / 'desktop__home__0.png').symlink_to(outer / 'secret.png')
        (work / 'changed.json').write_text(json.dumps(['desktop__home__0.png']))
        (work / 'report.json').write_text('[]')
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        r = subprocess.run([sys.executable, str(SCRIPT)], cwd=work, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([p.name for p in (work / 'report').rglob('*') if p.is_file()], ['index.html'])
        self.assertNotIn('img/', (work / 'report' / 'index.html').read_text())

    def test_file_names_from_the_judge_cannot_reach_files_outside_the_screenshot_folders(self):
        outer = self.root / 'outer'
        work = outer / 'vr'
        work.mkdir(parents=True)
        (outer / 'secret.txt').write_text('TOP SECRET')
        (outer / 'x.png').write_text('TOP SECRET')
        for kind in ('baseline', 'current', 'diff'):
            write_png(work / kind / 'desktop__home__0.png')
        (work / 'changed.json').write_text(json.dumps(['desktop__home__0.png']))
        (work / 'report.json').write_text(json.dumps([
            {'file': 'desktop__home__0.png', 'severity': 4, 'seen': 's', 'findings': []},
            {'file': '../../x.png', 'severity': 5, 'seen': 's', 'findings': []},          # not a compared file
            {'file': '/etc/passwd', 'severity': 5, 'findings': []},
            {'file': ['a'], 'severity': 5, 'findings': []},
        ]))
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        r = subprocess.run([sys.executable, str(SCRIPT)], cwd=work, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        page = (work / 'report' / 'index.html').read_text()
        copied = [p.name for p in (work / 'report').rglob('*') if p.is_file()]
        self.assertEqual(sorted(copied), ['desktop__home__0.png'] * 3 + ['index.html'])
        self.assertNotIn('TOP SECRET', ''.join(p.read_text(errors='ignore') for p in (work / 'report').rglob('*') if p.is_file() and p.suffix != '.png'))
        self.assertNotIn('x.png', page)
        self.assertIn('Ignored 3 judge entries for files that were not compared', page)
        self.assertEqual(page.count('class="card'), 1)              # one card: the severity of the ignored entries is not counted

    def test_a_changed_file_name_that_is_not_a_plain_file_name_is_never_copied(self):
        outer = self.root / 'outer'
        work = outer / 'vr'
        work.mkdir(parents=True)
        (outer / 'x.png').write_text('TOP SECRET')
        for name in ['../../x.png', '/etc/hostname', '.hidden__a__0.png', 'a/b__c__0.png', '..']:
            if name in ('.hidden__a__0.png', 'a/b__c__0.png'):          # real images exist: only the name check can stop them
                for kind in ('baseline', 'current', 'diff'):
                    write_png(work / kind / name)
            (work / 'changed.json').write_text(json.dumps([name]))
            (work / 'report.json').write_text('[]')
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
            r = subprocess.run([sys.executable, str(SCRIPT)], cwd=work, capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual([p.name for p in (work / 'report').rglob('*') if p.is_file()], ['index.html'], name)
            self.assertNotIn('img/', (work / 'report' / 'index.html').read_text(), name)

    def test_changed_files_without_a_verdict_are_never_called_a_pass(self):
        for f in ['desktop__a__0.png', 'desktop__b__0.png']:
            self.images(f)
        self.put('changed.json', ['desktop__a__0.png', 'desktop__b__0.png'])
        self.put('report.json', [])                                    # the judge said nothing about either
        page = self.run_report()
        self.assertIn('INCOMPLETE', page)
        self.assertIn('2 of 2 changed screenshots have no usable verdict from the judge', page)
        self.assertNotIn('PASS', page)
        self.put('report.json', [{'file': 'desktop__a__0.png', 'severity': 0, 'seen': 's', 'findings': []}])   # one of two
        page = self.run_report()
        self.assertIn('INCOMPLETE', page)
        self.assertIn('1 of 2 changed screenshots have no usable verdict', page)
        self.assertNotIn('PASS', page)
        self.put('report.json', [{'file': 'desktop__a__0.png', 'severity': 0, 'seen': 's', 'findings': []},
                                 {'file': 'desktop__b__0.png', 'severity': 2, 'seen': 's', 'findings': []}])  # both judged
        page = self.run_report()
        self.assertIn('PASS', page)
        self.assertNotIn('INCOMPLETE', page)

    def test_a_verdict_the_judge_could_not_complete_is_not_a_verdict(self):
        for f in ['desktop__a__0.png', 'desktop__b__0.png']:
            self.images(f)
        self.put('changed.json', ['desktop__a__0.png', 'desktop__b__0.png'])
        self.put('report.json', [
            {'file': 'desktop__a__0.png', 'severity': 0, 'seen': 's', 'findings': [], 'severity_raw': 'high', 'judge_incomplete': True},
            {'file': 'desktop__b__0.png', 'severity': 1, 'seen': 's', 'findings': [], 'judge_incomplete': False},
        ])
        page = self.run_report()
        self.assertIn('INCOMPLETE', page)
        self.assertIn('1 of 2 changed screenshots have no usable verdict', page)
        self.assertNotIn('PASS', page)
        self.assertIn('No usable verdict', page)
        self.assertLess(page.index('desktop__a__0.png'), page.index('Other changes ('))      # it is in "Needs a look"
        self.put('report.json', [
            {'file': 'desktop__a__0.png', 'severity': 1, 'seen': 's', 'findings': [], 'severity_raw': 'high', 'judge_incomplete': False},
            {'file': 'desktop__b__0.png', 'severity': 1, 'seen': 's', 'findings': [], 'judge_incomplete': False},
        ])
        self.assertIn('PASS', self.run_report())             # a usable re-check completed it


if __name__ == '__main__':
    unittest.main()
