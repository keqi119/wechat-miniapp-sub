"""Package the approved seven screens as one network-free review fragment."""
from pathlib import Path
import base64, json, re, sys
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent
names = ['home','catalog','use','mine','profile','payments','bill']
assets, markup, styles = {}, [], []

def asset(file):
    file = file.resolve()
    if not file.is_relative_to(root):
        raise ValueError('Asset outside review directory: ' + str(file))
    name = file.name
    mime = 'image/webp' if file.suffix == '.webp' else 'image/png'
    assets[name] = 'data:' + mime + ';base64,' + base64.b64encode(file.read_bytes()).decode('ascii')
    return name

def scope_css(css, scope):
    output = []
    for rule in css:
        if 'selector' in rule:
            selector = re.sub(r'\.([a-zA-Z_][\w-]*)',r'.nd-\1',rule['selector'])
            selector = re.sub(r'\bwx-button\b','button',selector)
            selector = re.sub(r'\bwx-view\b','div',selector)
            selector = re.sub(r'\bwx-text\b','span',selector)
            selectors = []
            for part in selector.split(','):
                part = part.strip()
                if part in ['body',':root','wx-page']:
                    selectors.append(scope)
                else:
                    selectors.append(scope + ' ' + part)
            value = re.sub(r'(?<![\w-])(-?\d*\.?\d+)px',r'calc(\1px * var(--nd-scale))',rule['style'])
            value = re.sub(r'url\([^)]*\)','none',value)
            output.append(','.join(selectors) + '{' + value + '}')
        elif 'media' in rule:
            output.append('@media ' + rule['media'] + '{' + scope_css(rule['rules'],scope) + '}')
    return '\n'.join(output)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome',headless=True)
    page = browser.new_page(viewport={'width':390,'height':844})
    for name in names:
        page.goto((root/'screens'/(name+'.html')).as_uri(),wait_until='load')
        page.locator('link[rel="stylesheet"]').evaluate_all('(links) => links.forEach(link => link.remove())')
        page.add_style_tag(content=(root/'proposal.css').read_text(encoding='utf-8'))
        data = page.evaluate('''() => {
          const collect = rules => [...rules].flatMap(r => r.selectorText ? [{selector:r.selectorText,style:r.style.cssText}] : r.media ? [{media:r.conditionText,rules:collect(r.cssRules)}] : []);
          const styles = [...document.styleSheets].slice(1).flatMap(s => collect(s.cssRules));
          const clone = document.querySelector('#app').cloneNode(true);
          const urls = [];
          clone.querySelectorAll('img').forEach(img => { urls.push(img.src); img.dataset.asset = decodeURIComponent(img.src.split('/').at(-1)); img.removeAttribute('src'); });
          clone.querySelectorAll('*').forEach(el => {
            el.className = [...el.classList].map(c => 'nd-' + c).join(' ');
            if (el.hasAttribute('style')) el.removeAttribute('style');
            const tag = el.tagName.toLowerCase();
            if (tag === 'wx-view' && el.hasAttribute('data-handler')) el.classList.add('nd-pressable-block');
            const replacement = {'wx-view':'div','wx-text':'span','wx-button':'button'}[tag];
            if (replacement) {
              const next = document.createElement(replacement);
              [...el.attributes].forEach(a => next.setAttribute(a.name,a.value));
              if (replacement === 'button') { next.type='button'; next.classList.add('cursor-interaction'); }
              next.append(...el.childNodes); el.replaceWith(next);
            }
          });
          clone.querySelectorAll('[data-handler]').forEach(el => {
            if (el.tagName !== 'BUTTON' && el.dataset.handler !== 'updateName') {
              const next = document.createElement('button');
              [...el.attributes].forEach(a => next.setAttribute(a.name,a.value));
              next.type='button'; next.classList.add('cursor-interaction');
              next.append(...el.childNodes); el.replaceWith(next);
            }
          });
          const mark=clone.querySelector('.nd-profile-mark');
          if(mark){mark.textContent='';const i=document.createElement('img');i.dataset.asset='person-active.png';i.alt='';mark.append(i);}
          return {css:styles,html:clone.innerHTML,urls};
        }''')
        for url in data['urls']:
            file = unquote(urlparse(url).path).lstrip('/')
            asset(Path(file))
        scope = '#nd-ui-review .nd-screen[data-screen="' + name + '"]'
        styles.append(scope_css(data['css'],scope))
        hidden = '' if name == 'home' else ' hidden'
        role = ' role="tabpanel" aria-labelledby="nd-tab-' + name + '"' if name in names[:4] else ''
        markup.append('<section id="nd-screen-'+name+'" class="nd-screen" data-screen="'+name+'"'+role+hidden+'>'+data['html']+'</section>')
    browser.close()
for icon in ['home','car','key','person']:
    for suffix in ['','-active']:
        asset(root/'assets'/(icon+suffix+'.png'))
template = (root/'navigation-template.html').read_text(encoding='utf-8')
fragment = template.replace('/*__PAGE_STYLES__*/','\n'.join(styles)).replace('<!--__PAGE_MARKUP__-->','\n'.join(markup)).replace('/*__ASSET_DATA__*/',json.dumps(assets,ensure_ascii=False,separators=(',',':')))
assert len(fragment.encode('utf-8')) < 1_000_000
assert not re.search(r'<(?:!doctype|html|head|body|iframe)\b',fragment,re.I)
assert 'fetch(' not in fragment and 'XMLHttpRequest' not in fragment
(root/'ninda-navigation.html').write_text(fragment,encoding='utf-8')
print(json.dumps({'bytes':len(fragment.encode('utf-8')),'screens':len(names),'assets':len(assets),'nestedFrames':0,'networkRequests':0}))
