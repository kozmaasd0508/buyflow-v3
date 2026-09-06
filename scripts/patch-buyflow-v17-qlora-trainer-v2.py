import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-buyflow-v17-qlora-trainer-v2.py <trainer.py>")

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")

old = '''            self.max_seen = max(self.max_seen, len(full_ids))
            if len(full_ids) > MAX_LENGTH:
                self.truncated += 1
                # Preserve the assistant target by keeping the tail while retaining a prompt prefix.
                overflow = len(full_ids) - MAX_LENGTH
                cut = min(overflow, max(0, prefix - 8))
                full_ids = full_ids[cut:]
                prefix = max(0, prefix - cut)
                if len(full_ids) > MAX_LENGTH:
                    full_ids = full_ids[-MAX_LENGTH:]
                    prefix = max(0, prefix - (len(full_ids) - MAX_LENGTH))
            labels = [-100] * prefix + full_ids[prefix:]
            if not any(x != -100 for x in labels):
                raise RuntimeError(f"No assistant target tokens in row {row.get('id')}")
'''

new = '''            self.max_seen = max(self.max_seen, len(full_ids))

            # Split BEFORE truncation so assistant targets can never disappear.
            # Only the oldest prompt tokens may be dropped; the complete assistant
            # target is always preserved.
            prompt_part = list(full_ids[:prefix])
            target_ids = list(full_ids[prefix:])
            if not target_ids:
                raise RuntimeError(f"No assistant target tokens before truncation in row {row.get('id')}")
            if len(target_ids) >= MAX_LENGTH:
                raise RuntimeError(
                    f"Assistant target itself is too long in row {row.get('id')}: "
                    f"{len(target_ids)} tokens >= max_length {MAX_LENGTH}"
                )

            if len(prompt_part) + len(target_ids) > MAX_LENGTH:
                self.truncated += 1
                keep_prompt = MAX_LENGTH - len(target_ids)
                prompt_part = prompt_part[-keep_prompt:] if keep_prompt > 0 else []

            full_ids = prompt_part + target_ids
            prefix = len(prompt_part)
            labels = [-100] * prefix + target_ids

            if len(full_ids) > MAX_LENGTH:
                raise RuntimeError(f"Internal truncation failure in row {row.get('id')}")
            if len(labels) != len(full_ids):
                raise RuntimeError(f"Input/label length mismatch in row {row.get('id')}")
            if sum(x != -100 for x in labels) != len(target_ids):
                raise RuntimeError(f"Assistant masking mismatch in row {row.get('id')}")
'''

if old not in s:
    raise RuntimeError("Expected V1 truncation block not found; refusing to patch unknown trainer")

s = s.replace(old, new, 1)
s = s.replace(
    'print("BUYFLOW V17 - GEMMA 3 12B QLORA TRAINING")',
    'print("BUYFLOW V17 - GEMMA 3 12B QLORA TRAINING V2")',
    1,
)
p.write_text(s, encoding="utf-8")
print("TRAINER PATCH V2: PASS")
print("Assistant-target-preserving truncation: ENABLED")
