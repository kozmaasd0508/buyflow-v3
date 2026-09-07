from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: patch-buyflow-gpt-oss-o1-lowthink.py <benchmark.py>')

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

repls = [
    ('        "stream": False,\n        "format": SCHEMA,', '        "stream": False,\n        "think": "low",\n        "format": "json",'),
    ('        "options": {"temperature": 0, "num_predict": 128},', '        "options": {"temperature": 0, "num_predict": 256},'),
    ('print("Runtime: Ollama structured JSON schema + closed BuyFlow enums")', 'print("Runtime: Ollama JSON mode + GPT-OSS think=low + closed BuyFlow enums")'),
    ('        "structured_schema": True,', '        "structured_schema": False,\n        "reasoning_effort": "low",'),
]

for old, new in repls:
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f'Expected exactly one occurrence, got {n}: {old}')
    s = s.replace(old, new)

p.write_text(s, encoding='utf-8')
print('GPT-OSS O1 LOW-THINK PATCH: PASS')
print('format=json | think=low | num_predict=256')
print('Same O1 holdout retained because previous attempts returned no scorable predictions.')
