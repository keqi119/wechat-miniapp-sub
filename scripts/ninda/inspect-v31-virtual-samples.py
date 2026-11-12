from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
import pdfplumber
from pypdf import PdfReader
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]/'docs/legal/drafts/ninda/launch-20261109-virtual-acceptance'
records=[]
for f in sorted(ROOT.glob('*.pdf')):
 out=ROOT/f.stem;out.mkdir(exist_ok=True)
 pdf=pdfium.PdfDocument(f);pages=[]
 for stale in out.glob('page-*.png'):
  if int(stale.stem.split('-')[-1])>len(pdf):stale.unlink()
 with pdfplumber.open(f) as check:
  for i,page in enumerate(pdf):
   im=page.render(scale=1.3).to_pil();target=out/f'page-{i+1:02d}.png';im.save(target)
   cp=check.pages[i];outside=[c for c in cp.chars if c.get('text','').strip() and (c['x0']<40 or c['x1']>cp.width-40 or c['top']<40 or c['bottom']>cp.height-15)]
   pages.append({'page':i+1,'png':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'outsideContentBounds':len(outside),'characters':len(cp.chars)})
  texts=[p.extract_text() or '' for p in check.pages]
  assert all('仅用于实名、电子签、支付与归档验证，不形成真实车辆租赁或交付义务' in t for t in texts), 'notice missing on a page'
  text='\n'.join(texts)
  (out/'extracted.txt').write_text(text,'utf-8')
 thumbs=[]
 for p in pages:
  im=Image.open(out/p['png']);im.thumbnail((595,842));thumbs.append(im)
 sheet=Image.new('RGB',(1200,860*((len(thumbs)+1)//2)),'#dddddd')
 for i,im in enumerate(thumbs):sheet.paste(im,((i%2)*600,(i//2)*860))
 sheet.save(ROOT/(f.stem+'-contact.png'))
 for start in range(0,len(thumbs),6):
  batch=thumbs[start:start+6];view=Image.new('RGB',(1200,860*((len(batch)+1)//2)),'#dddddd')
  for j,im in enumerate(batch):view.paste(im,((j%2)*600,(j//2)*860))
  view.save(out/f'contact-{start+1:02d}-{start+len(batch):02d}.png')
 attachments=PdfReader(f).attachments
 fixed=(Path(__file__).resolve().parents[2]/'docs/legal/versions/ninda/v31-initial-20261108/01.json').read_bytes()
 exact=any(data==fixed for name in attachments for data in attachments[name])
 if f.stem.startswith('02'):assert exact,'missing exact approved fixed-template bytes'
 records.append({'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'pageCount':len(pdf),'pages':pages,'unresolvedMarker':('【' in text or '待填写' in text),'exactFixedTemplateAttachment':exact})
(ROOT/'qa.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps([{'file':r['file'],'pages':r['pageCount'],'outside':sum(p['outsideContentBounds'] for p in r['pages']),'unresolved':r['unresolvedMarker']} for r in records]))
