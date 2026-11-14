#!/usr/bin/env python3
"""
Local forced aligner for Huellas Master using Vosk (Kaldi HMM-DNN) + Banded Phonetic
Needleman-Wunsch + 10ms PCM RMS speech-envelope clamping.

Outputs VoiceAlignmentSidecarV2 JSON atomically for macOS Intel x86_64, Render, and GitHub Pages.
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import unicodedata
from typing import Dict, List, Optional, Tuple

try:
    import audioop  # Fast C implementation available in CPython 3.11
except ImportError:
    audioop = None  # type: ignore

SAMPLE_RATE = 16000
FRAME_MS = 10
FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) // 1000  # 160 samples = 10ms
FRAME_BYTES = FRAME_SAMPLES * 2  # 16-bit mono = 320 bytes
FRAME_SEC = FRAME_MS / 1000.0

PAUSE_TAG_RE = re.compile(
    r'[\[{]\s*(?:(?:pausa|pause|silencio)\s*:?\s*)?([0-9]{1,2}(?:[.,][0-9]+)?)\s*(?:s|seg|segundos|ms|milisegundos)?\s*[\]}]|[\[{]\s*(?:pausa|pause|silencio)\s*:?\s*[\]}]',
    re.IGNORECASE,
)

HASH_PAUSE_RE = re.compile(
    r'[\[{]\s*(?:pausa|pause|silencio)\s*[:=]?\s*\d+(?:[.,]\d+)?\s*s?\s*[\]}]',
    re.IGNORECASE,
)

NON_SENTENCE_ABBREVS = {
    'a.c.', 'd.c.', 'dr.', 'dra.', 'sr.', 'sra.', 'srta.', 'prof.', 'st.',
    'mr.', 'mrs.', 'ms.', 'vol.', 'cap.', 'num.', 'núm.', 'fig.', 'pág.', 'ee.uu.',
}

ROMAN_NUMERALS: Dict[str, str] = {
    'II': 'dos',
    'III': 'tres',
    'IV': 'cuatro',
    'V': 'cinco',
    'VI': 'seis',
    'VII': 'siete',
    'VIII': 'ocho',
    'IX': 'nueve',
    'X': 'diez',
    'XI': 'once',
    'XII': 'doce',
    'XIII': 'trece',
    'XIV': 'catorce',
    'XV': 'quince',
    'XVI': 'dieciseis',
    'XVII': 'diecisiete',
    'XVIII': 'dieciocho',
    'XIX': 'diecinueve',
    'XX': 'veinte',
    'XXI': 'veintiuno',
    'XXII': 'veintidos',
}

ONES = [
    'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete',
    'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidos', 'veintitres',
    'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve',
]

TENS = {
    30: 'treinta',
    40: 'cuarenta',
    50: 'cincuenta',
    60: 'sesenta',
    70: 'setenta',
    80: 'ochenta',
    90: 'noventa',
}

HUNDREDS = {
    100: 'ciento',
    200: 'doscientos',
    300: 'trescientos',
    400: 'cuatrocientos',
    500: 'quinientos',
    600: 'seiscientos',
    700: 'setecientos',
    800: 'ochocientos',
    900: 'novecientos',
}


def compute_voice_script_align_hash(raw_script: str) -> str:
    """Exact UTF-8 FNV-1a hash matching TypeScript computeVoiceScriptAlignHash."""
    norm = HASH_PAUSE_RE.sub(' ', raw_script or '')
    norm = re.sub(r'\s+', ' ', norm).strip().lower()
    b = norm.encode('utf-8')
    h1 = 0x811c9dc5
    for byte in b:
        h1 ^= byte
        h1 = (h1 * 0x01000193) & 0xFFFFFFFF
    return f"{h1:08x}_{len(b)}"


def integer_to_spanish_words(n: int) -> List[str]:
    """Expand an integer 0..999,999,999 into spoken Spanish words."""
    if n < 0:
        return ['menos'] + integer_to_spanish_words(-n)
    if n == 0:
        return ['cero']
    if n < 30:
        return [ONES[n]]
    if n < 100:
        t = (n // 10) * 10
        u = n % 10
        if u == 0:
            return [TENS[t]]
        return [TENS[t], 'y', ONES[u]]
    if n == 100:
        return ['cien']
    if n < 1000:
        h = (n // 100) * 100
        rem = n % 100
        if rem == 0:
            return [HUNDREDS[h]]
        return [HUNDREDS[h]] + integer_to_spanish_words(rem)
    if n < 1_000_000:
        thousands = n // 1000
        rem = n % 1000
        if thousands == 1:
            prefix = ['mil']
        else:
            t_words = integer_to_spanish_words(thousands)
            if t_words and t_words[-1] == 'uno':
                t_words[-1] = 'un'
            prefix = t_words + ['mil']
        if rem == 0:
            return prefix
        return prefix + integer_to_spanish_words(rem)
    if n < 1_000_000_000:
        millions = n // 1_000_000
        rem = n % 1_000_000
        if millions == 1:
            prefix = ['un', 'millon']
        else:
            m_words = integer_to_spanish_words(millions)
            if m_words and m_words[-1] == 'uno':
                m_words[-1] = 'un'
            prefix = m_words + ['millones']
        if rem == 0:
            return prefix
        return prefix + integer_to_spanish_words(rem)
    return [c for ch in str(n) for c in integer_to_spanish_words(int(ch))]


def strip_accents_lower(text: str) -> str:
    nfd = unicodedata.normalize('NFD', text.lower())
    return ''.join(ch for ch in nfd if unicodedata.category(ch) != 'Mn')


def spanish_phonetic_key(raw: str) -> str:
    """Normalize Spanish word into phonetic comparison key tolerant of ASR homophones."""
    s = unicodedata.normalize('NFD', (raw or '').lower())
    out_chars: List[str] = []
    for ch in s:
        if ch == '\u0303':
            # Keep ñ distinction if preceding char was n
            if out_chars and out_chars[-1] == 'n':
                out_chars[-1] = 'ñ'
            continue
        if unicodedata.category(ch) == 'Mn':
            continue
        if 'a' <= ch <= 'z':
            out_chars.append(ch)
    s = ''.join(out_chars)
    if not s:
        return ''

    # Protect 'ch' and 'll' before dropping silent 'h'
    s = s.replace('ch', 'X')
    s = s.replace('h', '')
    s = s.replace('X', 'C')  # C = /tS/

    s = s.replace('qu', 'k')
    s = s.replace('gu', 'g')  # simplified gue/gui -> ge/gi before g->j
    s = re.sub(r'c([ei])', r's\1', s)
    s = s.replace('c', 'k')
    s = s.replace('z', 's')
    s = s.replace('v', 'b')
    s = s.replace('w', 'u')
    s = re.sub(r'g([ei])', r'j\1', s)
    s = s.replace('ll', 'y')
    s = s.replace('x', 'ks')
    s = s.replace('ñ', 'ny')

    # Collapse consecutive identical letters
    dedup: List[str] = []
    for ch in s:
        if not dedup or dedup[-1] != ch:
            dedup.append(ch)
    return ''.join(dedup)


def levenshtein_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    if la < lb:
        a, b = b, a
        la, lb = lb, la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def expand_token_to_spoken_words(display_tok: str) -> List[str]:
    """Expand a visual Spanish token (numbers, years, Romans, abbreviations, compounds) into spoken words."""
    core = display_tok.strip('"\'«»()[]¡¿.,;:!?…—–')
    if not core:
        return []

    core_lower = core.lower()
    if core_lower in ('a.c', 'a.c.'):
        return ['antes', 'de', 'cristo']
    if core_lower in ('d.c', 'd.c.'):
        return ['despues', 'de', 'cristo']
    if core_lower in ('dr', 'dr.'):
        return ['doctor']
    if core_lower in ('dra', 'dra.'):
        return ['doctora']
    if core_lower in ('sr', 'sr.'):
        return ['senor']
    if core_lower in ('sra', 'sra.'):
        return ['senora']
    if core_lower in ('ee.uu', 'ee.uu.'):
        return ['estados', 'unidos']
    if core_lower in ('km²', 'km2'):
        return ['kilometros', 'cuadrados']
    if core_lower in ('m²', 'm2'):
        return ['metros', 'cuadrados']

    suffix_words: List[str] = []
    if core.endswith('%'):
        core = core[:-1]
        suffix_words = ['por', 'ciento']
    elif core_lower.endswith('km²') and len(core) > 3:
        core = core[:-3]
        suffix_words = ['kilometros', 'cuadrados']
    elif core_lower.endswith('mg') and core[:-2].replace('.', '').replace(',', '').isdigit():
        core = core[:-2]
        suffix_words = ['miligramos']
    elif core_lower.endswith('kg') and core[:-2].replace('.', '').replace(',', '').isdigit():
        core = core[:-2]
        suffix_words = ['kilogramos']
    elif core_lower.endswith('km') and core[:-2].replace('.', '').replace(',', '').isdigit():
        core = core[:-2]
        suffix_words = ['kilometros']

    # Thousands-separated integer: e.g. 1.500, 1.330, 12.000
    if re.fullmatch(r'\d{1,3}(?:\.\d{3})+', core):
        val = int(core.replace('.', ''))
        return integer_to_spanish_words(val) + suffix_words

    # Plain integer
    if re.fullmatch(r'\d+', core):
        val = int(core)
        return integer_to_spanish_words(val) + suffix_words

    # Decimal number: e.g. 1.5 or 14,25
    m_dec = re.fullmatch(r'(\d+)[.,](\d+)', core)
    if m_dec:
        int_part = int(m_dec.group(1))
        frac_str = m_dec.group(2)
        if frac_str.startswith('0') and len(frac_str) > 1:
            frac_words = [w for ch in frac_str for w in integer_to_spanish_words(int(ch))]
        else:
            frac_words = integer_to_spanish_words(int(frac_str))
        return integer_to_spanish_words(int_part) + ['punto'] + frac_words + suffix_words

    # Roman numerals II..XXII (strictly uppercase)
    if core in ROMAN_NUMERALS:
        return [ROMAN_NUMERALS[core]]

    # Hyphenated / slash compounds
    if '-' in core or '/' in core:
        parts = [p for p in re.split(r'[-/]+', core) if p]
        expanded: List[str] = []
        for p in parts:
            expanded.extend(expand_token_to_spoken_words(p))
        return expanded + suffix_words

    clean = strip_accents_lower(re.sub(r'[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9]', '', core))
    if not clean:
        return suffix_words
    return [clean] + suffix_words


def tokenize_voiceover_script(raw_script: str) -> Tuple[List[dict], List[dict]]:
    """
    Tokenize voiceoverScript into display tokens with breakFlags and 1-to-M spoken atoms.
    breakFlag: 0=normal, 1=clause(,;—–), 2=sentence(.!?…:), 3=paragraph(\\n\\n), 4=[pausa: Xs]
    """
    text = (raw_script or '').replace('\r\n', '\n').replace('\r', '\n')
    tokens: List[dict] = []

    def mark_prev_break(flag: int) -> None:
        if tokens and flag > tokens[-1]['breakFlag']:
            tokens[-1]['breakFlag'] = flag

    pos = 0
    for m in PAUSE_TAG_RE.finditer(text):
        chunk = text[pos:m.start()]
        _append_chunk_tokens(chunk, tokens)
        mark_prev_break(4)
        pos = m.end()
    _append_chunk_tokens(text[pos:], tokens)

    # Expand 1-to-M into spoken atoms keeping parentTokenIdx
    atoms: List[dict] = []
    for idx, tok in enumerate(tokens):
        spoken_list = expand_token_to_spoken_words(tok['text'])
        if not spoken_list:
            # Keep minimal placeholder atom so token never loses ordering
            spoken_list = ['']
        for sw in spoken_list:
            atoms.append({
                'word': sw,
                'pkey': spanish_phonetic_key(sw),
                'parentIdx': idx,
            })

    return tokens, atoms


def _append_chunk_tokens(chunk: str, tokens: List[dict]) -> None:
    if not chunk or not chunk.strip():
        return
    paragraphs = re.split(r'\n\s*\n+', chunk.strip())
    for p_idx, para in enumerate(paragraphs):
        raw_parts = para.strip().split()
        for w in raw_parts:
            # Handle standalone em-dash / en-dash by attaching breakFlag=1 to previous token
            if re.fullmatch(r'[—–-]+', w):
                if tokens and tokens[-1]['breakFlag'] < 1:
                    tokens[-1]['breakFlag'] = 1
                continue

            # Split words glued around em-dash like "siglo—y" -> ["siglo—", "y"]
            sub_parts = re.split(r'(?<=[—–])(?=\S)', w)
            for sw in sub_parts:
                if not sw:
                    continue
                bflag = 0
                stripped_right = sw.rstrip('"\'»”)]')
                lower_core = stripped_right.lower()
                if stripped_right.endswith(('—', '–')):
                    bflag = 1
                elif re.search(r'[.!?…:]$', stripped_right):
                    if lower_core not in NON_SENTENCE_ABBREVS:
                        bflag = 2
                elif re.search(r'[,;]$', stripped_right):
                    bflag = 1

                tokens.append({
                    'text': sw,
                    'breakFlag': bflag,
                })
        if p_idx < len(paragraphs) - 1 and tokens:
            if tokens[-1]['breakFlag'] < 3:
                tokens[-1]['breakFlag'] = 3


def resolve_ffmpeg_bin() -> str:
    for cand in (
        shutil.which('ffmpeg'),
        '/usr/local/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
        '/usr/bin/ffmpeg',
    ):
        if cand and os.path.exists(cand):
            return cand
    raise RuntimeError('ffmpeg binary not found in PATH or standard macOS locations.')


def decode_audio_pcm16(audio_path: str) -> bytes:
    ffmpeg_bin = resolve_ffmpeg_bin()
    cmd = [
        ffmpeg_bin,
        '-v', 'error',
        '-nostdin',
        '-i', audio_path,
        '-vn',
        '-ac', '1',
        '-ar', str(SAMPLE_RATE),
        '-f', 's16le',
        'pipe:1',
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0 or len(proc.stdout) < 320:
        err_msg = proc.stderr.decode('utf-8', errors='replace').strip()
        raise RuntimeError(f'ffmpeg decode failed ({proc.returncode}): {err_msg}')
    # Ensure even byte count (16-bit samples)
    even_len = len(proc.stdout) - (len(proc.stdout) % 2)
    return proc.stdout[:even_len]


def compute_rms_and_silences(pcm_bytes: bytes) -> Tuple[List[float], List[bool], List[Tuple[float, float]], float]:
    n_frames = max(1, (len(pcm_bytes) + FRAME_BYTES - 1) // FRAME_BYTES)
    rms_frames: List[float] = [0.0] * n_frames

    if audioop is not None:
        for i in range(n_frames):
            chunk = pcm_bytes[i * FRAME_BYTES : (i + 1) * FRAME_BYTES]
            if len(chunk) >= 2:
                rms_frames[i] = audioop.rms(chunk, 2) / 32768.0
    else:
        for i in range(n_frames):
            chunk = pcm_bytes[i * FRAME_BYTES : (i + 1) * FRAME_BYTES]
            ns = len(chunk) // 2
            if ns > 0:
                samples = struct.unpack(f'<{ns}h', chunk[: ns * 2])
                rms_frames[i] = math.sqrt(sum(s * s for s in samples) / ns) / 32768.0

    sorted_rms = sorted(rms_frames)
    p15 = sorted_rms[min(len(sorted_rms) - 1, max(0, int(0.15 * len(sorted_rms))))]
    voice_floor = max(0.0115, 2.8 * p15)
    speech_frames = [r >= voice_floor for r in rms_frames]

    # Extract raw silence intervals >= 0.12s and merge tiny <0.05s noise blips
    raw_silences: List[Tuple[float, float]] = []
    sil_start: Optional[float] = None
    for idx, is_sp in enumerate(speech_frames):
        t = idx * FRAME_SEC
        if not is_sp:
            if sil_start is None:
                sil_start = t
        else:
            if sil_start is not None:
                if t - sil_start >= 0.12:
                    raw_silences.append((sil_start, t))
                sil_start = None
    total_dur = (len(pcm_bytes) / 2) / SAMPLE_RATE
    if sil_start is not None and total_dur - sil_start >= 0.12:
        raw_silences.append((sil_start, total_dur))

    silences: List[Tuple[float, float]] = []
    for s_start, s_end in raw_silences:
        if silences and s_start - silences[-1][1] < 0.05:
            silences[-1] = (silences[-1][0], s_end)
        elif s_end - s_start >= 0.14:
            silences.append((s_start, s_end))

    return rms_frames, speech_frames, silences, voice_floor


def run_vosk_asr(pcm_bytes: bytes, model_dir: str) -> List[dict]:
    import vosk  # Imported lazily so --help / py_compile work outside venv

    vosk.SetLogLevel(-1)
    model = vosk.Model(model_dir)
    rec = vosk.KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(True)

    stt_words: List[dict] = []
    chunk_bytes = 16000  # 0.5s chunks
    for offset in range(0, len(pcm_bytes), chunk_bytes):
        chunk = pcm_bytes[offset : offset + chunk_bytes]
        if rec.AcceptWaveform(chunk):
            res = json.loads(rec.Result())
            for w in res.get('result', []) or []:
                txt = str(w.get('word', '')).strip()
                if txt and txt != '[unk]':
                    stt_words.append({
                        'word': txt,
                        'pkey': spanish_phonetic_key(txt),
                        'start': float(w['start']),
                        'end': float(w['end']),
                        'conf': float(w.get('conf', 1.0)),
                    })

    final_res = json.loads(rec.FinalResult())
    for w in final_res.get('result', []) or []:
        txt = str(w.get('word', '')).strip()
        if txt and txt != '[unk]':
            stt_words.append({
                'word': txt,
                'pkey': spanish_phonetic_key(txt),
                'start': float(w['start']),
                'end': float(w['end']),
                'conf': float(w.get('conf', 1.0)),
            })

    stt_words.sort(key=lambda x: (x['start'], x['end']))
    return stt_words


def banded_phonetic_align(atoms: List[dict], stt_words: List[dict]) -> List[Optional[int]]:
    """
    Banded Needleman-Wunsch alignment between script spoken atoms (N) and Vosk STT words (M).
    Returns matched_stt_idx[i] for each atom i (or None if unaligned).
    """
    N = len(atoms)
    M = len(stt_words)
    if N == 0 or M == 0:
        return [None] * N

    B = max(90, math.ceil(0.12 * max(N, M)))
    GAP = -1.2
    NEG_INF = -1e12

    score_cache: Dict[Tuple[str, str], float] = {}

    def pair_score(ka: str, kb: str) -> float:
        if not ka or not kb:
            return -2.0
        if ka == kb:
            return 3.4 if len(ka) >= 4 else 3.0
        cached = score_cache.get((ka, kb))
        if cached is not None:
            return cached
        la, lb = len(ka), len(kb)
        max_len = la if la > lb else lb
        # Early length pruning: if difference > 45% of max_len, similarity cannot reach 0.55
        if abs(la - lb) > max_len * 0.45:
            score_cache[(ka, kb)] = -2.0
            return -2.0
        dist = levenshtein_distance(ka, kb)
        sim = 1.0 - (dist / max_len)
        sc = (2.5 * sim - 0.3) if sim >= 0.55 else -2.0
        score_cache[(ka, kb)] = sc
        return sc

    # Row-wise banded DP storing compact tracebacks: 0=diag, 1=up(gap stt), 2=left(gap atom)
    j_bounds: List[Tuple[int, int]] = [(0, 0)] * (N + 1)
    traces: List[bytes] = [b''] * (N + 1)

    j0_hi = min(M, B)
    j_bounds[0] = (0, j0_hi)
    prev_dp = [j * GAP for j in range(j0_hi + 1)]
    prev_lo = 0

    for i in range(1, N + 1):
        center = round((i * M) / N)
        j_lo = max(0, center - B)
        j_hi = min(M, center + B)
        j_bounds[i] = (j_lo, j_hi)
        width = j_hi - j_lo + 1
        curr_dp = [NEG_INF] * width
        tr = bytearray(width)
        atom_key = atoms[i - 1]['pkey']
        prev_hi = prev_lo + len(prev_dp) - 1

        for idx in range(width):
            j = j_lo + idx
            best = NEG_INF
            best_op = 1

            # Up: (i-1, j) + GAP
            if prev_lo <= j <= prev_hi:
                up_sc = prev_dp[j - prev_lo] + GAP
                if up_sc > best:
                    best = up_sc
                    best_op = 1

            # Left: (i, j-1) + GAP
            if idx > 0:
                left_sc = curr_dp[idx - 1] + GAP
                if left_sc > best:
                    best = left_sc
                    best_op = 2

            # Diag: (i-1, j-1) + match/mismatch
            if j > 0 and prev_lo <= j - 1 <= prev_hi:
                diag_sc = prev_dp[(j - 1) - prev_lo] + pair_score(atom_key, stt_words[j - 1]['pkey'])
                if diag_sc > best:
                    best = diag_sc
                    best_op = 0

            curr_dp[idx] = best
            tr[idx] = best_op

        traces[i] = bytes(tr)
        prev_dp = curr_dp
        prev_lo = j_lo

    # Find best endpoint at row N (allow trailing gap if audio ends slightly early)
    n_lo, n_hi = j_bounds[N]
    best_j = n_hi
    best_final = NEG_INF
    for idx, val in enumerate(prev_dp):
        j = n_lo + idx
        adjusted = val + (M - j) * GAP * 0.25
        if adjusted > best_final:
            best_final = adjusted
            best_j = j

    matched: List[Optional[int]] = [None] * N
    i = N
    j = best_j
    while i > 0 and j >= 0:
        j_lo, j_hi = j_bounds[i]
        if not (j_lo <= j <= j_hi):
            i -= 1
            continue
        op = traces[i][j - j_lo]
        if op == 0 and j > 0:
            sc = pair_score(atoms[i - 1]['pkey'], stt_words[j - 1]['pkey'])
            if sc > 0:
                matched[i - 1] = j - 1
            i -= 1
            j -= 1
        elif op == 1:
            i -= 1
        else:
            j -= 1

    return matched


def build_speech_prefix_sum(speech_frames: List[bool]) -> List[int]:
    pref = [0] * (len(speech_frames) + 1)
    acc = 0
    for idx, sp in enumerate(speech_frames):
        if sp:
            acc += 1
        pref[idx + 1] = acc
    return pref


def map_speech_fraction_to_time(
    t_left: float,
    t_right: float,
    frac: float,
    speech_prefix: List[int],
) -> float:
    """Invert cumulative active-speech frames over [t_left, t_right] so gaps skip silences."""
    if t_right <= t_left:
        return t_left
    f_clamped = max(0.0, min(1.0, frac))
    if f_clamped <= 0.0:
        return t_left
    if f_clamped >= 1.0:
        return t_right

    max_frame = len(speech_prefix) - 1
    idx_l = max(0, min(max_frame, int(math.floor(t_left / FRAME_SEC))))
    idx_r = max(idx_l, min(max_frame, int(math.ceil(t_right / FRAME_SEC))))
    total_speech = speech_prefix[idx_r] - speech_prefix[idx_l]
    if total_speech <= 0:
        return t_left + f_clamped * (t_right - t_left)

    target_count = speech_prefix[idx_l] + f_clamped * total_speech
    # Binary search in speech_prefix[idx_l : idx_r + 1]
    pos = bisect.bisect_left(speech_prefix, target_count, idx_l, idx_r + 1)
    pos = max(idx_l, min(idx_r, pos))
    t_mapped = pos * FRAME_SEC
    return max(t_left, min(t_right, t_mapped))


def interpolate_unmatched_atoms(
    atoms: List[dict],
    stt_words: List[dict],
    matched_stt_idx: List[Optional[int]],
    speech_frames: List[bool],
    speech_prefix: List[int],
    audio_dur: float,
) -> List[Tuple[float, float]]:
    N = len(atoms)
    atom_bounds: List[Optional[Tuple[float, float]]] = [None] * N
    for i, m_idx in enumerate(matched_stt_idx):
        if m_idx is not None:
            sw = stt_words[m_idx]
            s = max(0.0, min(audio_dur, sw['start']))
            e = max(s + 0.02, min(audio_dur, sw['end']))
            atom_bounds[i] = (s, e)

    # Determine first/last active speech bounds for edge anchors
    first_speech_t = 0.0
    for idx, sp in enumerate(speech_frames):
        if sp:
            first_speech_t = max(0.0, idx * FRAME_SEC - 0.03)
            break
    last_speech_t = audio_dur
    for idx in range(len(speech_frames) - 1, -1, -1):
        if speech_frames[idx]:
            last_speech_t = min(audio_dur, (idx + 1) * FRAME_SEC + 0.04)
            break

    i = 0
    while i < N:
        if atom_bounds[i] is not None:
            i += 1
            continue
        run_start = i
        while i < N and atom_bounds[i] is None:
            i += 1
        run_end = i  # exclusive

        t_left = atom_bounds[run_start - 1][1] if run_start > 0 and atom_bounds[run_start - 1] else first_speech_t
        t_right = atom_bounds[run_end][0] if run_end < N and atom_bounds[run_end] else last_speech_t
        if t_right < t_left:
            t_right = t_left

        weights = [max(2.0, float(len(atoms[k]['pkey']) or len(atoms[k]['word']) or 2)) for k in range(run_start, run_end)]
        total_w = max(1.0, sum(weights))
        cum_w = 0.0
        for idx_in_run, k in enumerate(range(run_start, run_end)):
            s_t = map_speech_fraction_to_time(t_left, t_right, cum_w / total_w, speech_prefix)
            cum_w += weights[idx_in_run]
            e_t = map_speech_fraction_to_time(t_left, t_right, cum_w / total_w, speech_prefix)
            if e_t <= s_t:
                e_t = min(t_right, s_t + 0.03)
            atom_bounds[k] = (s_t, e_t)

    return [b if b is not None else (0.0, 0.04) for b in atom_bounds]


def clamp_tokens_with_rms(
    tokens: List[dict],
    atoms: List[dict],
    atom_bounds: List[Tuple[float, float]],
    speech_frames: List[bool],
    silences: List[Tuple[float, float]],
    audio_dur: float,
) -> List[Tuple[str, float, float, int]]:
    num_tokens = len(tokens)
    tok_ranges: List[List[float]] = [[audio_dur, 0.0] for _ in range(num_tokens)]
    for atom, (s, e) in zip(atoms, atom_bounds):
        p_idx = atom['parentIdx']
        if s < tok_ranges[p_idx][0]:
            tok_ranges[p_idx][0] = s
        if e > tok_ranges[p_idx][1]:
            tok_ranges[p_idx][1] = e

    n_frames = len(speech_frames)

    def frame_has_speech(t_sec: float) -> bool:
        idx = max(0, min(n_frames - 1, int(t_sec / FRAME_SEC)))
        return speech_frames[idx]

    # Clamp starts/ends against 10ms speech envelope around silence boundaries
    for idx in range(num_tokens):
        s, e = tok_ranges[idx]
        if e < s:
            s, e = e, s
        prev_e = tok_ranges[idx - 1][1] if idx > 0 else 0.0
        next_s = tok_ranges[idx + 1][0] if idx + 1 < num_tokens else audio_dur

        # If token start sits in silence (>140ms gap before it or idx==0), advance to onset - 35ms
        if idx == 0 or s - prev_e >= 0.14:
            if not frame_has_speech(s):
                f_start = max(0, int(s / FRAME_SEC))
                f_limit = min(n_frames - 1, int(min(e - 0.04, s + 0.35) / FRAME_SEC))
                for f in range(f_start, f_limit + 1):
                    if speech_frames[f]:
                        s = max(prev_e, f * FRAME_SEC - 0.035)
                        break

        # If token end bleeds into silence (>=180ms gap after it or last token), trim to voice tail + 45ms
        if idx == num_tokens - 1 or next_s - e >= 0.18:
            if not frame_has_speech(e):
                f_end = min(n_frames - 1, int(e / FRAME_SEC))
                f_min = max(0, int(max(s + 0.04, e - 0.35) / FRAME_SEC))
                for f in range(f_end, f_min - 1, -1):
                    if speech_frames[f]:
                        e = min(next_s, (f + 1) * FRAME_SEC + 0.045)
                        break

        tok_ranges[idx][0] = s
        tok_ranges[idx][1] = max(s + 0.02, e)

    # Strict monotonicity & 3-decimal rounding
    result: List[Tuple[str, float, float, int]] = []
    cursor = 0.0
    for idx, tok in enumerate(tokens):
        raw_s, raw_e = tok_ranges[idx]
        s = round(max(cursor, min(audio_dur - 0.02, raw_s)), 3)
        e = round(max(s + 0.02, min(audio_dur, raw_e)), 3)
        if e <= s:
            e = round(min(audio_dur, s + 0.02), 3)
        cursor = e
        result.append((tok['text'], s, e, int(tok['breakFlag'])))

    return result


def detect_slogan_split_bounds(
    words_out: List[Tuple[str, float, float, int]],
    silences: List[Tuple[float, float]],
    audio_dur: float,
) -> Tuple[float, float]:
    """Locate the acoustic end of the opening slogan ('seguimos sus rastros' / 'deja una huella')."""
    search_limit = min(len(words_out), 240)
    norm_words = [
        strip_accents_lower(re.sub(r'[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]', '', w[0]))
        for w in words_out[:search_limit]
    ]

    match_end_idx = -1
    for target in (['seguimos', 'sus', 'rastros'], ['deja', 'una', 'huella']):
        tlen = len(target)
        for i in range(0, max(0, len(norm_words) - tlen + 1)):
            if norm_words[i : i + tlen] == target and words_out[i + tlen - 1][2] <= 120.0:
                match_end_idx = i + tlen - 1
                break
        if match_end_idx >= 0:
            break

    if match_end_idx < 0:
        return 0.0, 0.0

    slogan_end_sec = words_out[match_end_idx][2]
    next_word_start = (
        words_out[match_end_idx + 1][1]
        if match_end_idx + 1 < len(words_out)
        else audio_dur
    )

    # Prefer measured acoustic silence right after the slogan
    best_sil: Optional[Tuple[float, float]] = None
    for sil_s, sil_e in silences:
        if sil_e - sil_s < 0.35:
            continue
        if slogan_end_sec - 0.6 <= sil_s <= max(slogan_end_sec + 1.8, next_word_start + 0.2):
            best_sil = (sil_s, sil_e)
            break

    if best_sil is not None:
        return round(best_sil[0], 3), round(best_sil[1], 3)

    return round(slogan_end_sec, 3), round(max(slogan_end_sec, next_word_start), 3)


def align_voiceover(audio_path: str, script_path: str, model_dir: str, output_path: str) -> dict:
    t0 = time.time()
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f'Audio file not found: {audio_path}')
    if not os.path.exists(script_path):
        raise FileNotFoundError(f'Script file not found: {script_path}')
    if not os.path.isdir(model_dir):
        raise FileNotFoundError(f'Vosk model directory not found: {model_dir}')

    with open(script_path, 'r', encoding='utf-8') as f:
        raw_script = f.read()

    pcm_bytes = decode_audio_pcm16(audio_path)
    audio_dur = round((len(pcm_bytes) / 2) / SAMPLE_RATE, 3)

    _, speech_frames, silences, _ = compute_rms_and_silences(pcm_bytes)
    speech_prefix = build_speech_prefix_sum(speech_frames)

    stt_words = run_vosk_asr(pcm_bytes, model_dir)
    tokens, atoms = tokenize_voiceover_script(raw_script)

    matched_stt_idx = banded_phonetic_align(atoms, stt_words)
    matched_count = sum(1 for m in matched_stt_idx if m is not None)
    anchor_hit_rate = round(matched_count / max(1, len(atoms)), 4)

    atom_bounds = interpolate_unmatched_atoms(
        atoms, stt_words, matched_stt_idx, speech_frames, speech_prefix, audio_dur
    )
    words_out = clamp_tokens_with_rms(
        tokens, atoms, atom_bounds, speech_frames, silences, audio_dur
    )
    slogan_split_sec, slogan_sil_end_sec = detect_slogan_split_bounds(
        words_out, silences, audio_dur
    )

    payload = {
        'version': 2,
        'engine': 'vosk-es-0.42-nw-v2',
        'audioFile': os.path.basename(audio_path),
        'audioDurationSec': audio_dur,
        'scriptHash': compute_voice_script_align_hash(raw_script),
        'anchorHitRate': anchor_hit_rate,
        'sloganSplitAudioSec': slogan_split_sec,
        'sloganSilenceEndAudioSec': slogan_sil_end_sec,
        'words': [[w, s, e, bf] for (w, s, e, bf) in words_out],
    }

    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)
    tmp_path = f'{output_path}.tmp.{os.getpid()}'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, output_path)

    return {
        'ok': True,
        'output': output_path,
        'audioDurationSec': audio_dur,
        'wordCount': len(words_out),
        'sttWordCount': len(stt_words),
        'anchorHitRate': anchor_hit_rate,
        'sloganSplitAudioSec': slogan_split_sec,
        'sloganSilenceEndAudioSec': slogan_sil_end_sec,
        'elapsedSec': round(time.time() - t0, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Vosk local forced aligner for Huellas Master')
    parser.add_argument('--audio', required=True, help='Path to master voiceover MP3/WAV')
    parser.add_argument('--script-file', required=True, help='Path to UTF-8 voiceoverScript text file')
    parser.add_argument('--model-dir', required=True, help='Path to vosk-model-small-es-0.42 directory')
    parser.add_argument('--output', required=True, help='Output .align.json path')
    args = parser.parse_args()

    try:
        summary = align_voiceover(args.audio, args.script_file, args.model_dir, args.output)
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
