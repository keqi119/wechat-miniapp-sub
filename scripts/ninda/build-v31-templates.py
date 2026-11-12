"""Read-only DOCX extraction to reviewable, self-contained DRAFT template envelopes."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'.runtime/ninda/contract-fields-v31-20261107'
OUT=ROOT/'docs/legal/drafts/ninda/launch-20261107-v31'
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
def sha(b):return hashlib.sha256(b).hexdigest()
def txt(n):return ''.join(n.xpath('.//w:t/text()',namespaces=NS))
def prop(n,path):
 x=n.find(path,NS)
 return x is not None and x.get('{'+NS['w']+'}val','1') not in ('0','false','off')
def paragraph(n,loc):
 return {'type':'paragraph','loc':loc,'alignment':n.xpath('string(w:pPr/w:jc/@w:val)',namespaces=NS) or 'left','runs':[{'text':txt(r),'bold':prop(r,'w:rPr/w:b'),'italic':prop(r,'w:rPr/w:i'),'underline':prop(r,'w:rPr/w:u')} for r in n.findall('w:r',NS) if txt(r)]}
KINDS={'01':'SUBSCRIPTION','02-main':'COOPERATION','02-grant':'COOPERATION_GRANT','03':'VEHICLE_SWAP','04':'PRE_DELIVERY_CANCELLATION','05':'RENEWAL','06':'EARLY_TERMINATION'}
FIELDS={'01':{'P012':'product.minimumTermMonths','T1R1C2':'document.references','T1R2C2':'parties.details','T1R3C2':'subscription.conditions','T1R4C2':'vehicle.disclosures','T1R5C2':'delivery.plan','T1R7C2':'insurance.facts'},'02-main':{'P069':'partiesAndAccount.details','P070':'cooperation.vehicles','P071':'cooperation.revenue','P072':'cooperation.products'},'03':{'T1R1C2':'document.referencesAndParties','T1R2C2':'swap.vehiclesAndPeriod','T1R3C2':'swap.financialTerms','T1R4C2':'swap.deliveryAndInsurance'},'04':{'T1R1C2':'document.referencesAndParties','T1R2C2':'cancellation.facts','T1R3C2':'cancellation.financialTerms'},'05':{'T1R1C2':'document.referencesAndParties','T1R2C2':'renewal.originalTerms','T1R3C2':'renewal.newTerms','T1R4C2':'renewal.exceptions','P008':'product.minimumTermMonths'},'06':{'T1R1C2':'document.referencesAndParties','T1R2C2':'termination.facts','T1R3C2':'termination.financialTerms'}}
OUT.mkdir(parents=True,exist_ok=True)
manifest=[];bindings={}
for source in sorted((SRC/'sources').glob('*.docx')):
 prefix=source.name[:2]
 if prefix=='00':continue
 with ZipFile(source) as z:
  body=E.fromstring(z.read('word/document.xml')).find('w:body',NS)
  # These sources carry their visible numbering in text. Refuse an unhandled Word numbering source.
  assert not body.findall('.//w:numPr',NS),'Word numbering requires an explicit expansion adapter'
  nodes=[];pi=ti=0
  for n in body:
   if E.QName(n).localname=='p':
    pi+=1
    if txt(n).strip():nodes.append(paragraph(n,f'P{pi:03d}'))
   elif E.QName(n).localname=='tbl':
    ti+=1;rows=[]
    for ri,tr in enumerate(n.findall('w:tr',NS),1):
     cells=[]
     for ci,tc in enumerate(tr.findall('w:tc',NS),1):
      cells.append({'loc':f'T{ti}R{ri}C{ci}','paragraphs':[paragraph(p,f'T{ti}R{ri}C{ci}') for p in tc.findall('w:p',NS)],'span':int(tc.xpath('string(w:tcPr/w:gridSpan/@w:val)',namespaces=NS) or 1)})
     rows.append(cells)
    nodes.append({'type':'table','loc':f'T{ti}','widths':[int(x) for x in n.xpath('w:tblGrid/w:gridCol/@w:w',namespaces=NS)],'rows':rows})
 for artifact in (['02-main','02-grant'] if prefix=='02' else [prefix]):
  selected=[n for n in nodes if prefix!='02' or (int(n['loc'][1:])>=79)==(artifact=='02-grant')]
  removals=[n for n in selected if n['loc']=='P003']
  selected=[n for n in selected if n['loc']!='P003']
  markers=[]
  def visit(p):
   text=''.join(r['text'] for r in p['runs'])
   for i,m in enumerate(re.finditer('【[^】]+】',text)):
    token=m.group();cat='SIGNATURE' if token=='【电子签署区】' else 'PARAMETER' if token=='【待填写】' else 'BLOCK'
    role=('OWNER' if '授权人 ' in text else 'PLATFORM') if artifact=='02-grant' else ('PLATFORM' if '甲方' in text else 'OWNER') if artifact=='02-main' else ('CUSTOMER' if '甲方' in text else 'OWNER' if '乙方' in text else 'PLATFORM')
    key=role if cat=='SIGNATURE' else ('cooperation.partnerRateBps' if p['loc']=='P071' else 'cooperation.minimumTerms') if cat=='PARAMETER' and prefix=='02' else FIELDS[artifact][p['loc']]
    markers.append({'id':f'{artifact}:{p["loc"]}:{i}','loc':p['loc'],'token':token,'category':cat,'binding':key,'required':key!='renewal.exceptions'})
  for n in selected:
   if n['type']=='paragraph':visit(n)
   else:
    for row in n['rows']:
     for cell in row:
      for p in cell['paragraphs']:visit(p)
  envelope={'schema':'NINDA_V31_TEMPLATE','artifact':artifact,'kind':KINDS[artifact],'status':'DRAFT','source':{'zipSha256':'595a133668894fd1858e6aa67b9bbfebab5a6e38a10b71314c28d15e6dafe897','zipEntry':source.name,'docxSha256':sha(source.read_bytes()),'textSha256':sha('\n'.join(txt(n) for n in body).encode())},'nodes':selected,'markers':markers}
  encoded=json.dumps(envelope,ensure_ascii=False,indent=2)+'\n';(OUT/(artifact+'.json')).write_text(encoded,'utf-8')
  bindings[artifact]=markers
  transformations=[{'operation':'mapped-values-only','reason':'Replace every mapped block/parameter with server-resolved frozen facts; signature controls move to dedicated role-labelled seal page. Preserve substantive fixed text, table order and bold runs.'},{'operation':'signature-layout','reason':'Move generic signature note and role controls together to dedicated seal page; remove duplicated text-only role rows and heading from body. No signature or timestamp fabricated.'}]
  if prefix=='02':transformations += [{'operation':'split-independent-grant','boundary':'P079','reason':'Separate signatures; grant must render immutable agreement and attachment-one facts'},{'operation':'reviewed-fixed-expression','locations':['P071','P072'],'reason':'P071 replace ratio review instruction with actual owner ratio; P072 replace single review minimum with exact per-product minima, each at least three months.'},{'operation':'visible-fixed-template-appendix','reason':'Append complete approved 01 fixed clauses preserving bold and tables; label future order fields/signature controls without customer data. Bind exact approved content hash and raw UTF-8 byte SHA256; also embed exact bytes. Grant copies immutable main agreement reference and attachment-one scope.'},{'operation':'explicit-exceptions','reason':'Only actual agreed cooperation exceptions are added after P073; no blank exception fields.'}]
  if prefix=='05':transformations += [{'operation':'optional-exception','location':'T1R4C2','reason':'Preserve unchanged contact/deposit/general-term sentence; append only an explicitly supplied exception, no empty exception field.'}]
  manifest.append({'artifact':artifact,'kind':KINDS[artifact],'status':'DRAFT','sha256':sha((OUT/(artifact+'.json')).read_bytes()),'source':envelope['source'],'markers':len(markers),'changes':[{'operation':'remove-reviewer-paragraph','loc':n['loc'],'original':n} for n in removals]+transformations})
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
(ROOT/'apps/api/src/contract-terms/marker-bindings.ts').write_text('// Generated from read-only V3.1 DOCX by scripts/ninda/build-v31-templates.py.\nexport const markerBindings = '+json.dumps(bindings,ensure_ascii=False,indent=2)+' as const;\n','utf-8')
print(json.dumps([{'artifact':m['artifact'],'markers':m['markers']} for m in manifest]))
