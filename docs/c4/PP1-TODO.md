# PP1 to-do: day by day to Tuesday 20 Oct 2026

PP1 is on **Wednesday 21 Oct 2026**. Everything below is done by **Tuesday 20 Oct**.
Tick each box as you go (`[ ]` to `[x]`). "Claude" items are mine; "You" items are yours.

Related: the full plan (https://claude.ai/artifact/2MbK7fM9rcCVWtc9zg96uv), the decisions
(`docs/c4/research-scope-change.md`), how to run the analysis (`research/c4-viva/README.md`),
and the study materials (`research/c4-viva/study/`).

## The research in five lines

1. **Question:** when knowledge is controlled, which speech measures separate Sri Lankan students
   who have communication difficulty in English technical vivas from those who do not, and at
   what thresholds?
2. **Students:** 5 who say English makes vivas hard + 5 who are comfortable; all pass a 10-question MCQ.
3. **Viva:** you ask 5 DSA questions on Zoom from a fixed script; an observer rates each answer;
   Zoom saves each voice separately.
4. **Measures:** pauses, speaking speed, length of runs between pauses, pauses inside sentences,
   fillers, response time. The tool measures them; you only spot-check one minute per student.
5. **Result for PP1:** literature thresholds vs thresholds from your 10 students, with statistics.
   PP2 tests them on new students.

## Who does what

| | Claude | You |
|---|---|---|
| Code | All of it: analysis tool, statistics, charts, Colab notebook, system changes, tests | Run 3 commands (or tell me and I run them on your laptop) |
| Documents | Drafts: script, MCQ, forms, consent, ethics answers, slide text | Check them, add names, send them |
| People | Nothing | Supervisor, students, observer, the 10 vivas |
| Listening | Nothing | The counting check: 1 minute per student |
| PP1 | Slide text, charts, numbers checked | Slides, rehearsal, presenting |

## Done on Thu 8 Oct (Claude)

- [x] Measures module `app/domain/fluency.py` with the literature threshold profile, 19 tests (82 in total pass)
- [x] Decided while building: syllables are counted from the transcript (the acoustic count missed
      about 20%); primary measures are speech rate, mean length of run, mean silent pause and
      pauses per minute; the mid-clause share is exploratory because transcribers put commas
      where people pause
- [x] Syllable detection from audio `app/integrations/syllables.py` (Praat method, Parselmouth)
- [x] Analysis tool `scripts/analyze_recordings.py`, tested end to end on synthetic Zoom-style sessions
- [x] Statistics `research/c4-viva/analysis/run_stats.py`: p-values, best cut-offs, leave-one-out, charts, report
- [x] CrisperWhisper Colab notebook `research/c4-viva/analysis/crisperwhisper_colab.ipynb`
- [x] Study materials in `research/c4-viva/study/`: script, MCQ, Google Form text, observer form, Zoom set-up, ethics answers, participants template

## Thu 8 Oct (today)

You:

- [ ] Read the files in `research/c4-viva/study/` (30 minutes). Tell me anything to change.
- [ ] Check the 5 viva questions (`study/viva-script.md`) and the MCQ (`study/mcq.md`) yourself:
      are they at the right level for your batch? No supervisor review is needed.
- [ ] Ask 12 students (6 who find explaining in English hard, 6 who are comfortable; 2 are
      spares). Message:
      > Hi! I'm doing a 25-minute study for my final-year research: a short online form and a
      > 10-minute practice viva on data structures over Zoom, in English. No marks, nothing to
      > prepare. Could you help on Mon 12, Tue 13 or Wed 14 Oct?
- [ ] Find an **observer** (a friend or teammate) free for the session slots.

## Fri 9 Oct

You:

- [ ] Build the Google Form from `study/google-form.md` (about 1 hour): the short consent
      (type your name, SLIIT email and your supervisor's name where it says so), background,
      the 3 statements, the quiz with the answer key from `study/mcq.md`. Turn off "Collect
      email addresses".
- [ ] Give each student a code (P01 to P12) privately; send them the form; ask them to finish by
      Saturday night.
- [ ] Zoom desktop app: turn on the two settings in `study/zoom-setup.md`.
- [ ] Create `Documents/viva-study/recordings`; copy `study/participants.template.csv` to
      `Documents/viva-study/participants.csv`.

Claude:

- [x] Put the literature profile into the system's gap rule (new rule version, tests), so the
      system and the research use the same thresholds. Done 9 Oct: gap rules
      `c04-gap-1.4-literature-profile` (spec-domain.md section 6); 92 tests pass.
- [x] Test the private, local transcriber (works with `base.en`; the default `small.en`
      downloads about 0.5 GB on first use). Still to time on a real 10-minute file.

## Sat 10 Oct

You:

- [ ] **Practice viva** (10 minutes, not part of the results): a test run with a friend
      playing the student, to check that Zoom records both voices and that the analysis tool
      works on a real recording before the real sessions. Ask the 5 questions from the script,
      record, then rename the two audio files Zoom saves to `P00_student.m4a` and
      `P00_examiner.m4a` and put them in `Documents/viva-study/recordings`. Tell me "practice
      files are in"; I run the tool on them and fix anything that breaks.
- [ ] Optional: try the Colab notebook with `P00_student.m4a`.

Claude:

- [ ] Check the practice results; fix anything that looks wrong (question splitting, pauses,
      fillers).
- [x] "Analyse a recording" page in the viva system: upload a recording, see the measures
      against the thresholds. This links your research to your system for the PP1 demo.
      Done 8 Oct: **Speech lab** in the staff menu (admin only); see UI-UPGRADE-2026-10.md.

## Sun 11 Oct

You:

- [ ] From the form answers: average the 3 statements per student; 3.5 or more = difficulty,
      2.5 or less = comfortable; MCQ 6/10 or more. Pick 5 + 5 (+ spares). Fill
      `participants.csv` (code, group, mcq_score, self_report).
- [ ] Book the sessions: 3 or 4 a day, Mon to Wed. Send each student the Zoom link and the
      "Tell each student" part of `study/zoom-setup.md`.
- [ ] Confirm the observer's times; print 12 observer forms.

Claude:

- [ ] Finish the demo page; prepare the slide chart layout.

## Mon 12, Tue 13, Wed 14 Oct: the vivas

For **each** session (about 25 minutes):

- [ ] 10 minutes before: Zoom open, earphones on, script and observer form ready.
- [ ] Student and observer join; both click **Original sound**.
- [ ] Opening lines (not recorded), then **Record on this computer**, say "Participant P0X".
- [ ] Optional warm-up, then the 5 questions; follow-ups by the rule; stay silent during pauses.
- [ ] "That is the end of the viva. Thank you." Stop recording; optional self-rating questions.
- [ ] End the meeting; rename the two files to `P0X_student.m4a` and `P0X_examiner.m4a`; move them
      to the recordings folder; back up to a USB drive.
- [ ] Add the observer's overall answer and any notes to `participants.csv`.

Each evening:

- [ ] Tell me "sessions done"; I run the analysis tool on the day's files and check every student
      has sensible results.

## Thu 15 Oct

You:

- [ ] Colab: upload all `*_student.m4a` files to `analysis/crisperwhisper_colab.ipynb`, Run all,
      download `words.zip`, unzip it into the recordings folder. Then tell me; I re-run the tool.
- [ ] **Counting check:** open `results/count_check.csv`. For each student, play the given
      minute (`listen_from` to `listen_to` in `listen_in`); on paper, tick each "um"/"uh" and each
      clear silence (about half a second or more) while the student is answering. Type the totals
      into `your_fillers` and `your_pauses`. About 30 minutes in total.

Claude:

- [ ] Compare CrisperWhisper with Groq/local transcripts (filler counts) for your report.

## Fri 16 Oct

- [ ] Claude runs `run_stats.py`: `results/report.md`, `summary.csv` and charts.
- [ ] You and Claude read the report together. I explain every number in plain words. We
      write down the pilot cut-offs to show next to the literature ones.

## Sat 17 and Sun 18 Oct

You:

- [ ] Slides (outline in section 18 of the plan): the problem; why fillers alone are not enough;
      research question and hypotheses; method; system demo; measures; literature vs pilot
      thresholds; results; limitations; PP2 plan.
- [ ] Any PP1 progress-report text your batch requires (method and preliminary results).

Claude:

- [ ] Draft slide text and speaker notes from the real results; check every number.
- [ ] Charts for the slides from `results/charts/`.
- [ ] If time allows: a Colab notebook that trains a small filler detector on PodcastFillers'
      76,689 labelled 1-second clips (non-commercial research licence), plus code to run it on
      your recordings. You press "Run all" and wait about 3 to 4 hours. Its filler counts are
      compared with your counting check and CrisperWhisper. If these days get tight, it moves
      to PP2.

## Mon 19 Oct

- [ ] Full dry run of the presentation with a timer, including the live demo.
- [ ] Record a backup video of the demo in case the internet fails on the day.
- [ ] Code freeze: commit and push (I give you the commands).

## Tue 20 Oct

- [ ] Spare day for anything that slipped. Nothing new.

## Wed 21 Oct: PP1

## Definition of done for PP1

- [ ] Ethics form submitted; consent given by every participant
- [ ] At least 5 + 5 recorded vivas with results
- [ ] Counting check filled in
- [ ] `report.md` with group differences, literature vs pilot thresholds, leave-one-out accuracy
- [ ] System demo: viva prototype, plus the "Analyse a recording" page using the thresholds
- [ ] Slides rehearsed; backup video recorded; code committed and pushed

## If something goes wrong

| Problem | What to do |
|---|---|
| Ethics form is slow | Ask your supervisor what PP1 may show; run only the practice viva until it is cleared |
| Fewer than 5 + 5 students | Present what you have as a feasibility pilot; collect the rest in PP2 |
| Colab has no GPU | Use `--transcriber groq` (fast) or `--transcriber local` (private, slower) |
| A recording failed | Re-run that student's viva if possible; otherwise note it and continue |
| Results show no difference | That is still a valid finding for a pilot; report effect sizes and what PP2 changes |
