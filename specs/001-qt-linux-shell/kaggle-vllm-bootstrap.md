# Kaggle vLLM Bootstrap

This note captures the recommended runtime-management pattern for a temporary remote vision backend used by the Linux Qt shell.

## Why This Exists

Plain one-shot shell commands are not enough for Kaggle notebook operation. We need:

- explicit `subprocess.Popen(...)`
- pid-aware start/stop/restart handling
- startup wait with health probing
- readable logs
- reproducible port and environment handling

The implementation style is based on the user's proven `llama-server` Kaggle notebook workflow.

## Recommended First Backend

- `vLLM`
- `Qwen/Qwen2.5-VL-7B-Instruct`
- OpenAI-compatible `/v1` surface
- `TRITON_ATTN` for the first Kaggle T4 bootstrap

## Kaggle-Safe Attention Backend

The first bootstrap should force:

- `--attention-backend TRITON_ATTN`

Reason:

- Kaggle can fail during `flashinfer` JIT setup with linker errors such as `cannot find -lcuda`
- Kaggle T4 GPUs are `compute capability 7.5`, and the vLLM log shows `FLASH_ATTN` is rejected for this configuration with `compute capability not supported`
- the current `vLLM` build also rejects `XFORMERS` as an unknown backend name
- the current `vLLM` build accepts `TORCH_SDPA` for some multimodal internals but rejects it as a forced global backend because it is not registered in the attention backend registry used by this path
- with no forced backend, `vLLM` auto-selects `FLASHINFER`, which then fails again on Kaggle while linking `-lcuda`
- this is a runtime-environment and GPU-capability problem, not a model-choice problem
- `TRITON_ATTN` is the next explicit fallback to test in order to bypass `flashinfer` JIT entirely

## Suggested Notebook Pattern

1. Install runtime packages.
2. Build a launch command as a Python list.
3. Launch with `subprocess.Popen(...)`.
4. Write server stdout/stderr to a log file.
5. Poll `/v1/models` until ready.
6. Surface startup milestones from the log so the notebook reports phases instead of only `Ready: False`.
7. Keep a `stop_server()` helper that terminates by pid, not by broad port kill.
