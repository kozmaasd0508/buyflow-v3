from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: patch-buyflow-gpt-oss-o1-schema-lowthink.py <src.py> <dst.py>')

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
s = src.read_text(encoding='utf-8')

old_format = '        "format": SCHEMA,\n'
old_options = '        "options": {"temperature": 0, "num_predict": 128},\n'

if s.count(old_format) != 1:
    raise RuntimeError(f'Expected exactly one format schema line, found {s.count(old_format)}')
if s.count(old_options) != 1:
    raise RuntimeError(f'Expected exactly one num_predict=128 line, found {s.count(old_options)}')

s = s.replace(old_format, old_format + '        "think": "low",\n')
s = s.replace(old_options, '        "options": {"temperature": 0, "num_predict": 512},\n')

# Adjust banner text only; scoring logic/cases remain untouched.
s = s.replace('Runtime: Ollama structured JSON schema + closed BuyFlow enums',
              'Runtime: Ollama structured JSON schema + closed BuyFlow enums + think=low + num_predict=512')

dst.write_text(s, encoding='utf-8')
print('GPT-OSS O1 PATCH: PASS')
print('Schema constraint: ON')
print('think: low')
print('num_predict: 512')
print('Cases/scoring: unchanged')
