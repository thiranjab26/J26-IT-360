# Filler detector: results in plain words

## Part 1: trained on podcast clips (29 Oct 2026)

**What we did:** taught the computer to recognise when someone says "uh" or "um".

**How:** it heard about 67,000 short sound clips (1 second each) from the public PodcastFillers
dataset. Each clip came with the right answer ("this is uh", "this is um", "this is a normal
word", "this is a breath"...). After hearing them many times, it learned what fillers sound like.

**The test:** it then heard 9,475 new clips it had never heard, and its answers were checked.

**The result:**

- Out of every 100 real "uh/um" sounds, it found about **91** (recall 0.909).
- When it said "this is a filler", it was right about **93 times out of 100** (precision 0.935).
- Its overall score is **92 out of 100** (F1 0.922). A good result.

**Where it makes mistakes:** a short "uh" can sound like a small word such as "a", so it
sometimes mixes those two up.

**What this does not prove yet:** it was tested on podcast speakers, not your students on Zoom.
Part 2 tests it on your 10 students' recordings.

**One sentence for your supervisor:** "The detector finds 91% of fillers in test clips it never
heard before, and 93.5% of what it marks as a filler is correct (F1 = 0.92)."

### If someone asks for details

| Item | Value |
|---|---|
| Dataset | PodcastFillers v1.0.1 (Zhu et al., Interspeech 2022), https://zenodo.org/records/7121457 |
| Clips | 76,689 labelled 1-second clips, the dataset's own train, validation and test split |
| Model | Small convolutional network on log-mel sound features, about 240,000 weights |
| Training | 20 rounds (epochs); the best was round 19 (validation F1 0.920) |
| Test, filler against everything else | precision 0.935, recall 0.909, F1 0.922 |
| Test, all six labels | accuracy 0.849; uh F1 0.819, um F1 0.909 |
| The "loss" column in the log | the last small batch of each round only, so it jumps around; judge by the validation F1 |

### Where the files are

| File | Place |
|---|---|
| The notebook with all its output (show this to supervisors) | `Desktop/Research Project/Research Data/Model ipynb/filler_detector_colab.ipynb` |
| The model, `filler_cnn_v1.pt` | Google Drive, folder `c4-filler` |
| Its results and fingerprint, `filler_cnn_v1_results.json` | Google Drive, folder `c4-filler` |
| Model fingerprint (sha256) | `ba33cee256982119d708d230fd2dee9d22f2a8abc8f0396b8792b4e79a3cf7b8` |
| The clean notebook (to run again) | `research/c4-viva/analysis/filler_detector_colab.ipynb` |

## Part 2: your students' recordings (29 Oct 2026)

**What we did:** the model listened to the whole recordings of your 10 pilot students (P01 to
P10) and marked every "uh/um" it heard. We compared its marks with the 384 fillers CrisperWhisper
found. Then we taught it your students' voices and tested again. To keep that test fair, each
student was checked by a version that had never heard that student.

**The result (after teaching it your students' voices):**

- Out of every 100 fillers CrisperWhisper found, the detector found about **76** (recall 0.758).
- When it marked a filler, it was right about **68 times out of 100** (precision 0.678).
- Overall score **72 out of 100** (F1 0.716). Before teaching it your students' voices: 69.
- **Most important:** it ranks the students the same way. Students who say "uh/um" a lot get high
  counts and students who rarely do get low counts (correlation 0.90 between the two counts).
- The pilot cut-off (5.42 fillers per 100 words) gives the same answer with the detector's
  counts as with CrisperWhisper's for **9 of 10 students** (rough check on whole recordings).

**Why it is lower than part 1 (92):** your students speak with Sri Lankan accents on Zoom, not
American podcast English; CrisperWhisper is the reference but is not perfect either; and a filler
only counts as found if the times match within half a second.

**Where it makes mistakes:** it sometimes over-counts for students who rarely use fillers,
probably breaths or short words such as "a".

**One sentence for your supervisor:** "On the pilot students' Zoom recordings, tested on students
it had not heard, the detector found 76% of CrisperWhisper's fillers with 68% precision (F1 0.72),
and its filler counts per student correlate 0.90 with CrisperWhisper's."

**Rule for later:** the cut-offs must be calculated with the same counter that the system uses.
If the live viva counts fillers with this detector, the final cut-offs (all 30 students) should
use the detector's counts too.

### Details

| Item | Part 1 model | Adapted (student unseen) |
|---|---|---|
| Precision | 0.606 | 0.678 |
| Recall | 0.799 | 0.758 |
| F1 | 0.689 | 0.716 |
| Count correlation | 0.901 | 0.898 |

Results per student are kept offline in
`Research Data/Recordings/results/filler-detector-per-student.md`, not in this public repo: the
consent promises combined results only.

Settings (fixed before the results): a 1-second window every 0.1 s, uh + um score above 0.5 in
at least 2 windows in a row, a match within 0.5 s, 5 rounds of adaptation at learning rate 1e-4.

| File | Place |
|---|---|
| Notebook | `research/c4-viva/analysis/filler_detector_part2_colab.ipynb` |
| Final model `filler_cnn_v2.pt` (trained on all 10) and `filler_cnn_v2_results.json` | Google Drive, folder `c4-filler` |
| Model fingerprint (sha256) | `b77abe1d83a258c53ac37bea7ac216b3811a86b9c57d266aed772dd90d64fcfc` |

`filler_cnn_v2.pt` is the model to use. Freeze it before the first new student: the new
students are then its real test.
