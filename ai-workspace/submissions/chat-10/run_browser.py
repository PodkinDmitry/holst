"""CHAT 10 Chromium browser & CHAT04/06/07 regression gate.
Pass the generated CHAT10 fully patched JS (as built by build.py).
"""
from pathlib import Path
import argparse
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--component',required=True);options=ap.parse_args()
base=Path(__file__).parent

def sibling(package, name):
 for directory in (base.parent/package, base.parent/package.replace('chat-','xod-chat')):
  candidate=directory/name
  if candidate.is_file():return candidate
 raise FileNotFoundError(f'Missing sibling {package}/{name}; checkout chat-04/06/07/09 or specify complete workspace.')
source=Path(options.component).read_text()
cas=sibling('chat-09','xod-cas-view-coordinator.js').read_text()
adapter=(base/'xod-preset-idempotency-adapter.js').read_text()
css=sibling('chat-04','xod-youtube-table300.css').read_text()
html=(base/'preset-idempotency-browser.html').read_text()
html=html.replace('</head>','<style>'+css+'</style></head>')
html=html.replace('<script src="../chat-07/xod-youtube-table300.js"></script>','<script>'+source+'</script>')
html=html.replace('<script src="../chat-09/xod-cas-view-coordinator.js"></script>','<script>'+cas+'</script>')
html=html.replace('<script src="./xod-preset-idempotency-adapter.js"></script>','<script>'+adapter+'</script>')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='load')
 page.wait_for_function("document.querySelector('#summary').dataset.status !== 'RUNNING'",timeout=20000)
 print('CHAT10 BROWSER',page.locator('#summary').inner_text(),'PAGE_ERRORS',errors)
 for row in page.locator('#results li[data-status="FAIL"]').all():print(row.inner_text())
 assert '5/5 PASS' in page.locator('#summary').inner_text() and not errors
 page.close()
 # Earlier test suites with the new component to demonstrate no regressions.
 fixtures=[
  ('CHAT04', sibling('chat-04','xod-youtube-table300-test.html'),
    '<script src="./xod-youtube-table300.js"></script>','#test-summary','dataset.testStatus','37/37'),
  ('CHAT06',sibling('chat-06','saveview-after-destroy.html'),
    '<script src="../chat-04/xod-youtube-table300.js"></script>','#summary','dataset.status','4/4'),
  ('CHAT07',sibling('chat-07','remount-lifecycle.html'),
    '<script src="../chat-04/xod-youtube-table300.js"></script>','#summary','dataset.status','6/6'),
 ]
 for label,path,link,selector,attr,expected in fixtures:
  code=Path(path).read_text().replace('<link rel="stylesheet" href="./xod-youtube-table300.css">','<style>'+css+'</style>')
  code=code.replace(link,'<script>'+source+'</script>')
  pg=browser.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.set_content(code,wait_until='load')
  pg.wait_for_function(f"document.querySelector('{selector}').{attr} !== 'RUNNING'",timeout=40000)
  summary=pg.locator(selector).inner_text()
  print(label,'REGRESSION',summary,'PAGE_ERRORS',errs)
  assert (('37 / 37' in summary) if label=='CHAT04' else (expected+' PASS' in summary)) and not errs
  pg.close()
 browser.close()
