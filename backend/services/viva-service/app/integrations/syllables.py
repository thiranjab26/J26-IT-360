"""Syllable nuclei from audio, for speech rate without a transcript.

A Python version of the De Jong and Wempe (2009) Praat method, using Parselmouth:
intensity peaks above a silence threshold, separated by a dip of at least 2 dB, that
are voiced. Accent and pronunciation do not change the count, only timing and loudness.
Needs the optional `research` extra (praat-parselmouth).
"""

import numpy as np

SILENCE_DB = -25.0  # relative to the 99th percentile of intensity
MIN_DIP_DB = 2.0


def syllable_nuclei(samples, sample_rate, silence_db=SILENCE_DB, min_dip_db=MIN_DIP_DB):
    """Times in seconds of the syllable nuclei in a mono float signal."""
    import parselmouth

    if len(samples) < sample_rate * 0.1:
        return []
    sound = parselmouth.Sound(np.asarray(samples, dtype=np.float64), sampling_frequency=sample_rate)
    intensity = sound.to_intensity(minimum_pitch=50.0)
    values, times = intensity.values[0], intensity.xs()
    threshold = max(np.quantile(values, 0.99) + silence_db, values.min())
    peaks = [
        i
        for i in range(1, len(values) - 1)
        if values[i] > threshold and values[i] >= values[i - 1] and values[i] > values[i + 1]
    ]
    # As in the original script: keep a peak when intensity dips by more than min_dip_db
    # between it and the next peak. Unlike the script, the final peak is kept too.
    kept = [
        current
        for current, following in zip(peaks, peaks[1:], strict=False)
        if values[current] - values[current : following + 1].min() > min_dip_db
    ] + peaks[-1:]
    pitch = sound.to_pitch_ac(
        time_step=0.02,
        pitch_floor=30.0,
        max_number_of_candidates=4,
        silence_threshold=0.03,
        voicing_threshold=0.25,
        octave_cost=0.01,
        octave_jump_cost=0.35,
        voiced_unvoiced_cost=0.25,
        pitch_ceiling=450.0,
    )
    return [
        float(times[i])
        for i in kept
        if not np.isnan(pitch.get_value_at_time(times[i])) and pitch.get_value_at_time(times[i]) > 0
    ]
