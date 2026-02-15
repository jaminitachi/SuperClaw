---
name: tts
description: Generate speech audio from Markdown using Qwen3-TTS with Irene voice cloning
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<Purpose>
Convert Markdown documents into natural Korean speech audio using the Qwen3-TTS pipeline with
voice cloning. Uses the local `md_to_speech.py` script in the tts-pipeline project with
pre-configured Irene reference audio for consistent, warm-toned Korean narration. Supports
both Voice Clone mode (reference audio) and Custom Voice mode (built-in speakers).
</Purpose>

<Use_When>
- User says "TTS", "음성 만들어", "읽어줘", "음성 변환", "tts 만들어줘"
- User says "보고서 읽어줘", "이거 음성으로", "wav 파일 만들어"
- User wants to convert a Markdown report/document to audio
- User mentions "아이린 목소리", "Irene voice", "voice clone"
- User says "REPORT-TTS", "tts-pipeline"
- User wants a narrated version of documentation or reports
</Use_When>

<Do_Not_Use_When>
- User wants text-to-speech via a web API (ElevenLabs, Google TTS) -- different pipeline
- User wants real-time speech synthesis during conversation -- not batch TTS
- User wants speech-to-text (STT/ASR) -- opposite direction
- Input is not Markdown or plain text
</Do_Not_Use_When>

<Why_This_Exists>
SuperClaw generates detailed reports (USAGE-REPORT.md, REPORT-TTS.md) that are long to read.
Converting them to audio with a familiar, warm Korean voice lets the user listen during commutes
or while multitasking. The Qwen3-TTS pipeline handles Markdown parsing, section chunking, and
voice-cloned synthesis locally on Apple Silicon (MPS acceleration) without cloud API costs.
</Why_This_Exists>

<Execution_Policy>
- Always dry-run first to verify chunk count and section structure
- Default to Voice Clone mode with `irene_emotional_28s.wav` reference audio
- Use `PYTHONUNBUFFERED=1` and `python -u` for real-time progress output
- Run in background for full documents (38+ chunks take 10-30 minutes on MPS)
- Verify output file exists and has reasonable size after completion
- Keep previous outputs (don't overwrite) -- use versioned filenames
</Execution_Policy>

<Steps>
1. **Phase 1 - Identify Input**: Determine the Markdown file to convert
   - Check if user specified a file path
   - Default candidates: `~/projects/tts-pipeline/REPORT-TTS.md` (conversational report)
   - Verify the file exists and check line count

2. **Phase 2 - Dry Run**: Preview the conversion without running TTS
   ```bash
   # Find the Python binary: conda env or system python with qwen_tts installed
   # Default conda env name: qwen3-tts
   python md_to_speech.py --input <INPUT_FILE> --output /dev/null --dry-run
   ```
   - Confirm section count, chunk count, and total character count
   - Show user the section breakdown for approval

3. **Phase 3 - Select Voice Mode**: Choose synthesis parameters
   - **Voice Clone (default)**: Uses reference audio for speaker embedding
     - Default ref: `~/projects/tts-pipeline/ref_audio/irene_emotional_28s.wav`
     - Model: `Qwen/Qwen3-TTS-12Hz-0.6B-Base`
     - Mode: x-vector only (no ref text needed)
   - **Custom Voice (alternative)**: Uses built-in speaker
     - Speaker: `Sohee` (default) or user-specified
     - Model: `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`
     - Instruct: `따뜻하고 나긋나긋하게 읽어주세요`

4. **Phase 4 - Generate Audio**: Run the full TTS pipeline
   ```bash
   # Locate the TTS project directory (default: ~/projects/tts-pipeline)
   # Locate the conda python: ~/miniforge3/envs/qwen3-tts/bin/python (or conda run -n qwen3-tts python)
   export PATH="/opt/homebrew/bin:$PATH" && \
   PYTHONUNBUFFERED=1 conda run --no-banner -n qwen3-tts python -u \
     ~/projects/tts-pipeline/md_to_speech.py \
     --input <INPUT_FILE> \
     --output <OUTPUT_FILE> \
     --ref-audio ~/projects/tts-pipeline/ref_audio/irene_emotional_28s.wav \
     --language Korean \
     --section-pause 1.5 \
     --max-chars 300
   ```
   - Run in background (10-30 min for full reports)
   - Monitor progress periodically

5. **Phase 5 - Verify & Deliver**: Confirm output quality
   - Check file exists and size is reasonable (expect ~2-3MB per minute of audio)
   - Report duration and file size
   - Open the file with `open <output.wav>` for playback
</Steps>

<Tool_Usage>
**This skill uses Bash to invoke the Python TTS pipeline. No MCP tools required.**

Key command patterns:

- **Dry run**: `python md_to_speech.py --input FILE --output /dev/null --dry-run`
- **Voice Clone**: `python md_to_speech.py --input FILE --output OUT.wav --ref-audio REF.wav`
- **Custom Voice**: `python md_to_speech.py --input FILE --output OUT.wav --speaker Sohee --instruct "따뜻하게"`
- **Limit sections**: Add `--max-sections 3` for preview (first 3 sections only)
- **Chunk size**: `--max-chars 300` (default, good for Korean)
</Tool_Usage>

<Examples>
<Good>
User: "REPORT-TTS 음성 만들어줘"
Action: 1) Dry-run to check 38 chunks, 2) Run full TTS with irene_emotional_28s.wav, 3) Output superclaw_report_v2.wav (56MB, 20min), 4) open the wav file
Why good: Follows full pipeline, uses versioned filename, verifies output
</Good>

<Good>
User: "이 README를 음성으로 변환해줘, 처음 3섹션만"
Action: 1) Dry-run with --max-sections 3 to preview, 2) Run with --max-sections 3 --ref-audio irene_emotional_28s.wav, 3) Deliver partial audio for quick review
Why good: Uses --max-sections for fast preview, doesn't waste time on full generation
</Good>

<Good>
User: "소희 목소리로 해줘"
Action: 1) Switch to Custom Voice mode, 2) Run with --speaker Sohee --instruct "따뜻하고 나긋나긋하게 읽어주세요" (no --ref-audio), 3) Uses Qwen3-TTS-12Hz-0.6B-CustomVoice model
Why good: Correctly switches from Voice Clone to Custom Voice mode based on user request
</Good>

<Bad>
User: "TTS 만들어줘"
Action: Run full pipeline immediately without dry-run
Why bad: Should dry-run first to show section/chunk breakdown. Full generation takes 10-30 min.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- **Stop** if `qwen3-tts` conda env not found -- inform user: "conda env 'qwen3-tts' 필요. `mamba create -n qwen3-tts python=3.12 && mamba activate qwen3-tts && pip install qwen-tts torch soundfile`"
- **Stop** if SoX not installed -- inform user: `brew install sox`
- **Stop** if reference audio file not found -- list available files in `ref_audio/`
- **Stop** if model download hangs >5 min -- likely network issue, suggest `local_files_only=True`
- **Escalate** if chunk synthesis fails 3+ times consecutively -- model or memory issue
- **Escalate** if output file is 0 bytes -- synthesis completely failed
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Input Markdown file exists and is readable
- [ ] Dry-run completed showing section/chunk count
- [ ] Correct voice mode selected (Clone vs Custom)
- [ ] PYTHONUNBUFFERED=1 set for real-time progress
- [ ] Output file path uses versioned name (don't overwrite previous)
- [ ] Output file exists with reasonable size (>1MB for any meaningful audio)
- [ ] Duration reported to user
- [ ] File opened for playback
</Final_Checklist>

<Advanced>
## Environment Setup

```bash
# Conda environment
mamba create -n qwen3-tts python=3.12
mamba activate qwen3-tts
pip install qwen-tts torch torchaudio soundfile numpy

# SoX (audio processing dependency)
brew install sox

# Run via conda
conda run --no-banner -n qwen3-tts python md_to_speech.py --help
```

## Project Paths

| Resource | Path |
|----------|------|
| TTS Script | `~/projects/tts-pipeline/md_to_speech.py` |
| Report Script | `~/projects/tts-pipeline/REPORT-TTS.md` |
| Reference Audio | `~/projects/tts-pipeline/ref_audio/` |

## Available Reference Audio

| File | Duration | Style |
|------|----------|-------|
| `irene_emotional_28s.wav` | 28s | Warm, emotional (recommended) |
| `irene_74s_full.wav` | 74s | Full range, natural |
| `irene_asmr_19s.wav` | 19s | ASMR whisper |
| `irene_asmr_26s.wav` | 26s | ASMR whisper |

## Model Info

| Model | Size | Use Case |
|-------|------|----------|
| `Qwen/Qwen3-TTS-12Hz-0.6B-Base` | 1.7GB | Voice Clone (ref audio required) |
| `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | ~1.7GB | Built-in speakers (Sohee etc.) |
| `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | ~4GB | Higher quality clone (slower) |
| `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | ~4GB | Higher quality custom (slower) |

## Performance (Apple Silicon M-series, MPS)

- Model loading: ~60-90s (first run includes download)
- Per chunk (300 chars): ~15-30s
- Full REPORT-TTS.md (38 chunks): ~20-30 min
- Output size: ~2.7MB per minute of audio (24kHz WAV)

## Tips

- Use `--max-sections 2` for quick quality checks before full run
- The `irene_emotional_28s.wav` reference produces the warmest, most natural tone
- For longer documents, the 1.7B model gives better quality but takes 2-3x longer
- Voice Clone x-vector mode (no ref text) is more stable than ICL mode
- Always version output filenames to keep history
</Advanced>
