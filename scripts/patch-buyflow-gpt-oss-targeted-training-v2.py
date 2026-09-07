from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: patcher.py <src> <dst>')

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text(encoding='utf-8')

needle = '''import random\nfrom pathlib import Path\n\nos.environ.setdefault("UNSLOTH_ROCM_GFX_ARCH", "gfx1200")\n'''
replacement = '''import random\nfrom pathlib import Path\n\n# Clean inherited runtime overrides before importing Unsloth/bitsandbytes.\nos.environ.pop("BNB_ROCM_VERSION", None)\n_cache_root = Path.home() / "BuyFlowTools" / "gptoss-training"\n_cache_root.mkdir(parents=True, exist_ok=True)\nos.environ.setdefault("UNSLOTH_ROCM_GFX_ARCH", "gfx1200")\nos.environ.setdefault("UNSLOTH_COMPILE_LOCATION", str(_cache_root / "unsloth_compiled_cache"))\nos.environ.setdefault("HF_HOME", str(_cache_root / "hf-cache"))\n'''
if text.count(needle) != 1:
    raise SystemExit('Could not patch environment block exactly once')
text = text.replace(needle, replacement)

needle2 = '''    # Small forward/backward preflight before the long run.\n    print("Running Unsloth trainer preflight/eval...")\n    initial_eval = trainer.evaluate()\n    print("Initial eval:", json.dumps(initial_eval, ensure_ascii=False, default=str))\n\n    print("Starting REAL GPT-OSS targeted QLoRA training...")\n'''
replacement2 = '''    # Real one-batch forward/backward preflight before the long run.\n    print("Running one-batch forward/backward OOM preflight...")\n    trainer.model.train()\n    batch = next(iter(trainer.get_train_dataloader()))\n    batch = trainer._prepare_inputs(batch)\n    loss = trainer.compute_loss(trainer.model, batch)\n    if not torch.isfinite(loss).item():\n        raise RuntimeError(f"Non-finite preflight loss: {loss.item()}")\n    loss.backward()\n    torch.cuda.synchronize()\n    print(f"BACKWARD PRECHECK: PASS | loss={loss.item():.6f} | allocated={torch.cuda.memory_allocated()/1024**3:.2f} GB | reserved={torch.cuda.memory_reserved()/1024**3:.2f} GB")\n    trainer.model.zero_grad()\n    del batch, loss\n    torch.cuda.empty_cache()\n\n    print("Measuring initial targeted validation loss...")\n    initial_eval = trainer.evaluate()\n    print("Initial eval:", json.dumps(initial_eval, ensure_ascii=False, default=str))\n\n    print("Starting REAL GPT-OSS targeted QLoRA training...")\n'''
if text.count(needle2) != 1:
    raise SystemExit('Could not patch backward preflight block exactly once')
text = text.replace(needle2, replacement2)

# Add visible runtime hygiene diagnostics.
needle3 = '''    print(f"torch={torch.__version__} hip={getattr(torch.version, 'hip', None)}")\n'''
replacement3 = '''    print(f"torch={torch.__version__} hip={getattr(torch.version, 'hip', None)}")\n    print(f"BNB_ROCM_VERSION={os.environ.get('BNB_ROCM_VERSION')}")\n    print(f"UNSLOTH_COMPILE_LOCATION={os.environ.get('UNSLOTH_COMPILE_LOCATION')}")\n'''
if text.count(needle3) != 1:
    raise SystemExit('Could not patch runtime diagnostics exactly once')
text = text.replace(needle3, replacement3)

dst.write_text(text, encoding='utf-8')
print('GPT-OSS TARGETED TRAINER V2 PATCH: PASS')
