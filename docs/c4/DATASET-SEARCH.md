# Extra datasets for the filler detector (search of 30 Oct 2026)

What the detector needs: spontaneous English speech, second-language or South Asian voices,
and "uh/um" marked in time. ICE-SL is the only Sri Lankan English corpus found. It is available
on request, and the manual does not say whether the audio is shared. Until that is confirmed,
the pilot and new-student recordings stay the only Sri Lankan audio.

Any retraining must finish before the first new student; the model is frozen from then on.

## Worth using

| Dataset | What it is | Fit | Access |
|---|---|---|---|
| [ICE-SL](https://arts.cmb.ac.lk/ice-sl-research/) | Sri Lankan English, recorded 2010 to 2018; 300 spoken texts of 2,000 words each, so about 600,000 words by design; includes 20 classroom lessons and audio-only Skype calls | Best fit if the audio is shared. All fillers are written as "uh" ([manual](https://arts.cmb.ac.lk/wp-content/uploads/2025/06/Manual-to-ICE-SL-2019.pdf), pages 13 and 31), so "uh" and "um" are not separated. No word times are described, so CrisperWhisper would have to supply them. Without audio it cannot train the detector | Email ice-sl@anglistik.uni-giessen.de; ask whether audio is included and on what terms |
| [EdAcc](https://huggingface.co/datasets/edinburghcstr/edacc) | 40 hours of video-call conversations; 51 first languages; 6.95 GB | Best open match: call audio, L2 speakers, transcripts keep UH and UM. No word times, so CrisperWhisper would have to supply them. Indian English is named; Sri Lankan not confirmed | Open, CC-BY-SA |
| [IIITH-IED](https://arxiv.org/html/2411.17149v1) | Indian English NPTEL lectures; 1,277 filled pauses, annotated with start and end times | Closest to technical speech, and small enough to use as a test set too | On request from the authors |

## Maybe

| Dataset | What it is | Unknown |
|---|---|---|
| [SPIRE-SIES](https://arxiv.org/abs/2312.00698) | 170 hours of spontaneous Indian English; 23 hours transcribed | Whether fillers are labelled; access process |
| [LearnerVoice](https://arxiv.org/abs/2407.04280v2) | 50 hours from 58 Korean learners of English; fillers labelled in transcripts | Timestamps; a later paper says it is not yet released |
| [Sinhala speech corpus, Nadungodage et al. 2013](https://www.researchgate.net/publication/287432541_Developing_a_Speech_Corpus_for_Sinhala_Speech_Recognition) | Sinhala, not English; fillers such as "um", "ah", "er" and "mm" are defined in the paper | Whether audio can be obtained; whether tags have times. The paper's PDF link returned 404, so the 65-hour size and the spontaneous part are unconfirmed |

## Not useful

| Dataset | Why not |
|---|---|
| [Common Voice 27 English](https://mozilladatacollective.com/datasets/cmu5jplf300nwmh07iqvk9leo) | Read sentences, no fillers, 88.43 GB |
| [Sinhala corpus, LREC 2022](https://aclanthology.org/2022.lrec-1.546/) | Sinhala, not English; about cleaning transcripts; no fillers |
| [Bhasik DASIE](https://aikosh.indiaai.gov.in/home/datasets/details/bhasik_indian_english_disfluency_corpus.html) | 555 KB, appears to be text only |
| [DisfluencySpeech](https://huggingface.co/datasets/amaai-lab/DisfluencySpeech/tree/d60429ff97d3b8c0ff1e6aa2f1e7233c47eadd07/data) | One speaker in a studio |
| [nyralabs/disfluency_speech_english](https://huggingface.co/datasets/nyralabs/disfluency_speech_english) | Made from DisfluencySpeech, so the same single speaker |
| [Kaggle: Oral English Pronunciation Defect](https://www.kaggle.com/datasets/zara2099/oral-english-pronunciation-defect-dataset) | 4,000 rows of numbers, no audio and no transcripts, so nothing to train on. Measures pronunciation, which C4 never uses as evidence. The page says 27 columns but lists 24 |
| [Common Voice Spontaneous Speech, Sinhala](https://datacollective.mozillafoundation.org/datasets/cmmysetwg00fkmf07v0akjit6) | 21 clips, 0.12 hours, one speaker, Sinhala |
| [OpenSLR 52](https://www.openslr.org/52/) | Sinhala, not English; about 185,000 utterances; fillers not mentioned |
| [Switchboard](https://github.com/amritkromana/disfluency_detection_from_audio) | Must be obtained through LDC; native English phone calls add no L2 voices |
| [FluencyBank Timestamped](https://pubs.asha.org/doi/10.1044/2024_JSLHR-24-00070) | Adults who stutter, a different group from L2 students |

The Grok list was checked at each source on 30 Oct 2026. Grok's commercial Sinhala sets were not
checked, because they are paid and Grok itself says fillers are unlikely to be marked.
