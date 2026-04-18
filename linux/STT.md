# Sherpa-ONNX STT Setup

This project uses an external Sherpa-ONNX workspace for the preferred native-shell STT path.

The current arrangement is intentionally separate from this repository:

- the assistant repo stays in `~/clicky`
- the STT workspace lives in `~/stt`
- the STT runtime uses a separate Conda environment named `stt`

The Qt shell records native WAV files and sends them to the Sherpa-ONNX websocket server through the runtime when:

```env
STT_PROVIDER=sherpa_onnx
```

in `linux/.env`.

## Current External Layout

Expected external paths:

```text
~/stt/
  sherpa-parakeet/
    repo/                     # sherpa-onnx git checkout
    sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/
```

The runtime in this repository does not build Sherpa-ONNX for you. It only connects to the websocket server.

## Environment

The working setup discussed in this project uses:

- a Conda environment named `stt`
- an external workspace under `~/stt`

Activate the Conda environment before building or running the server:

```bash
conda activate stt
```

## Build Sherpa-ONNX

The current notes indicate a working server on `v1.12.38` with a small Python patch for the non-streaming websocket server.

Clone the repository:

```bash
cd ~/stt/sherpa-parakeet
git clone --branch v1.12.38 --depth 1 https://github.com/k2-fsa/sherpa-onnx repo
```

Build it:

```bash
cd ~/stt/sherpa-parakeet/repo
rm -rf build
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j"$(nproc)"
```

## Required Patch For `non_streaming_server.py`

The Python websocket server example in `python-api-examples/non_streaming_server.py` does not accept `--model-type` out of the box, but the NeMo Parakeet model requires:

```text
--model-type nemo_transducer
```

Patch the server script like this:

```bash
cd ~/stt/sherpa-parakeet/repo

python - <<'PY'
from pathlib import Path

p = Path("python-api-examples/non_streaming_server.py")
s = p.read_text()

old1 = '''    parser.add_argument(
        "--tokens",
        type=str,
        help="Path to tokens.txt",
    )
'''
new1 = '''    parser.add_argument(
        "--model-type",
        default="",
        type=str,
        help="If using NeMo transducer models, set this to nemo_transducer",
    )

    parser.add_argument(
        "--tokens",
        type=str,
        help="Path to tokens.txt",
    )
'''
if old1 not in s:
    raise SystemExit("Patch step 1 failed: tokens block not found")
s = s.replace(old1, new1, 1)

old2 = '''        recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=args.encoder,
            decoder=args.decoder,
            joiner=args.joiner,
            tokens=args.tokens,
            num_threads=args.num_threads,
            sample_rate=args.sample_rate,
            feature_dim=args.feat_dim,
            decoding_method=args.decoding_method,
            max_active_paths=args.max_active_paths,
            hotwords_file=args.hotwords_file,
            hotwords_score=args.hotwords_score,
            blank_penalty=args.blank_penalty,
            provider=args.provider,
        )
'''
new2 = '''        recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=args.encoder,
            decoder=args.decoder,
            joiner=args.joiner,
            tokens=args.tokens,
            model_type=args.model_type,
            num_threads=args.num_threads,
            sample_rate=args.sample_rate,
            feature_dim=args.feat_dim,
            decoding_method=args.decoding_method,
            max_active_paths=args.max_active_paths,
            hotwords_file=args.hotwords_file,
            hotwords_score=args.hotwords_score,
            blank_penalty=args.blank_penalty,
            provider=args.provider,
        )
'''
if old2 not in s:
    raise SystemExit("Patch step 2 failed: from_transducer block not found")
s = s.replace(old2, new2, 1)

p.write_text(s)
print("Patched:", p)
PY
```

Verify the new argument exists:

```bash
python ./python-api-examples/non_streaming_server.py --help | grep model-type
```

## Run The Server

Start the non-streaming websocket server like this:

```bash
cd ~/stt/sherpa-parakeet/repo

python ./python-api-examples/non_streaming_server.py \
  --encoder ../sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx \
  --decoder ../sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx \
  --joiner ../sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx \
  --tokens ../sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt \
  --model-type nemo_transducer \
  --provider cpu \
  --port 6006
```

The assistant runtime should then use:

```env
STT_PROVIDER=sherpa_onnx
SHERPA_ONNX_SERVER_ADDR=127.0.0.1
SHERPA_ONNX_SERVER_PORT=6006
SHERPA_ONNX_SAMPLE_RATE=16000
SHERPA_ONNX_CHUNK_BYTES=10240
SHERPA_ONNX_TIMEOUT_SECONDS=30
```

## Smoke Test

The recommended first test is the sequential websocket client:

```bash
conda activate stt
cd ~/stt/sherpa-parakeet/repo

python ./python-api-examples/offline-websocket-client-decode-files-sequential.py \
  --server-addr 127.0.0.1 \
  --server-port 6006 \
  ../sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/test_wavs/en.wav
```

This is the most useful smoke test because it validates the same websocket path that the assistant runtime uses.

## Browser UI Warning

The sample server's built-in browser page is not a reliable test target in the current notes.

The recorded failure was:

```text
TypeError: 'ServerConnection' object is not subscriptable
```

inside `process_request`, caused by API differences in newer `websockets` versions.

For this project, prefer the websocket client smoke test above instead of relying on the sample HTML page.

## Audio Format Expectations

The assistant runtime currently sends Sherpa-ONNX:

- WAV input
- mono
- PCM16
- 16 kHz

This matches the current native Qt shell capture flow.

Browser `MediaRecorder` audio is not converted for Sherpa-ONNX in this repo, so Sherpa-ONNX should currently be treated as the native-shell STT backend, not the browser STT backend.

## Runtime Integration

The connection from this repo to Sherpa-ONNX is implemented in:

- [`linux/server.js`](./server.js)

Relevant runtime config lives in:

- [`linux/.env.example`](./.env.example)

The Qt shell native audio capture that feeds this backend lives in:

- [`linux/qt_shell/audio_capture.py`](./qt_shell/audio_capture.py)

## Current Status

The current documented state is:

- external STT workspace under `~/stt`
- separate `stt` Conda environment
- Sherpa-ONNX used as the preferred native-shell STT path
- assistant runtime successfully connected to the websocket server
- Qt shell native push-to-talk working with Sherpa-ONNX transcription
