from pathlib import Path

path = Path('public/app.html')
text = path.read_text(encoding='utf-8')
start = '<!-- ════════════════════════════════════════════════\n           VIEW: CHAT\n      ═════════════════════════════════════════════════ -->'
end = '<!-- ════════════════════════════════════════════════\n           VIEW: INCENTIVES (admin)\n      ═════════════════════════════════════════════════ -->'
idx = text.find(start)
if idx == -1:
    raise SystemExit('CHAT view start not found')
idx2 = text.find(end, idx)
if idx2 == -1:
    raise SystemExit('VIEW: INCENTIVES marker not found')
text = text[:idx] + text[idx2:]
legacy_start = '// ══════════════════════════════════════════════════════════════════\n// CHAT\n// ══════════════════════════════════════════════════════════════════\n\n'
legacy_end = '// ══════════════════════════════════════════════════════════════════\n// INSIGHTS — Enhanced Analytics (LG Leads + PCP Leads)\n// ══════════════════════════════════════════════════════════════════\n\n'
k = text.find(legacy_start)
if k != -1:
    l = text.find(legacy_end, k)
    if l == -1:
        raise SystemExit('Legacy INSIGHTS marker not found')
    text = text[:k] + text[l:]
text = text.replace("'RESET_PASSWORD':'badge-warning','CHAT_MSG':'badge-info','CREATE_INCENTIVE':'badge-success',","'RESET_PASSWORD':'badge-warning','CREATE_INCENTIVE':'badge-success',")
path.write_text(text, encoding='utf-8')
print('updated public/app.html')
