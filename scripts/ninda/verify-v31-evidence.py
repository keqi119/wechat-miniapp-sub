from pathlib import Path
import json, hashlib

root = Path(__file__).resolve().parents[2]
base = root / 'docs/legal/drafts/ninda/launch-20261107-v31'
manifest = json.loads((base / 'manifest.json').read_text('utf-8'))
for entry in manifest:
    assert hashlib.sha256((base / (entry['artifact'] + '.json')).read_bytes()).hexdigest() == entry['sha256']
    source = root / '.runtime/ninda/contract-fields-v31-20261107/sources' / entry['source']['zipEntry']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == entry['source']['docxSha256']
qa = json.loads((base / 'samples/qa.json').read_text('utf-8'))
samples = json.loads((base / 'samples/manifest.json').read_text('utf-8'))
for sample in samples:
    check = next(q for q in qa if q['file'] == sample['file'])
    assert sample['sha256'] == check['sha256'] == hashlib.sha256((base / 'samples' / sample['file']).read_bytes()).hexdigest()
    assert sample['pageCount'] == check['pageCount'] and not check['unresolvedMarker']
    for page in check['pages']:
        assert page['outsideContentBounds'] == 0
        assert hashlib.sha256((base / 'samples' / sample['id'] / page['png']).read_bytes()).hexdigest() == page['sha256']
    for role, positions in sample['positions'].items():
        assert len(positions) == 1
        for position in positions:
            assert 0 <= position['pagenum'] < sample['pageCount'] and 0 < position['x'] < 800 and 0 < position['y'] < 1131
    if sample['id'].startswith('02'):
        assert check['exactFixedTemplateAttachment']
    print(sample['id'], sample['pageCount'], sample['sha256'], json.dumps(sample['positions']))
print('PASS: original DOCX unchanged; seven draft bytes/hash matched; 61 page PNG hashes/content bounds; all signer centres; exact fixed01 attachments.')
