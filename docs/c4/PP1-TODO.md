# PP1 to-do: day by day to Tuesday 20 Oct 2026

PP1 is on **Wednesday 21 Oct 2026**. Everything below is done by **Tuesday 20 Oct**.
Tick each box as you go (`[ ]` to `[x]`). "Claude" items are mine; "You" items are yours.

Related: the full plan (https://claude.ai/artifact/2MbK7fM9rcCVWtc9zg96uv), the decisions
(`docs/c4/research-scope-change.md`), how to run the analysis (`research/c4-viva/README.md`),
and the study materials (`research/c4-viva/study/`).

## Catch-up list (Sun 11 Oct): Thursday to Sunday work, in order

To tick a box, change `[ ]` to `[x]` in this file (the preview only shows the result).

- [x] **Ethics PDF:** Natalie's title added, signed, uploaded to RP courseweb.
- [x] **Google Form:** new Section 1 description pasted, incognito and P00 tests done.
- **Recruit 10 students (5 + 5) and one observer** (message in Thu 8 Oct below). Send the form
  link and codes only after ethics approval. Book each viva as soon as a student qualifies.
  - [x] Done: 10 students (P01 to P10, 5 + 5) and an observer; all 10 vivas recorded by 16 Oct.
- [x] **Call set-up:** Zoom settings done. Study data lives in
      `Desktop/Research Project/Research Data/` (`Recordings/`, `Participants/participants.csv`,
      `Ethics/`, `Quiz/`); use these paths wherever this file says `Documents/viva-study`.
- [x] **Practice viva** with a friend today (Sat 10 Oct below), then tell me "practice files are in".
- [x] Colab notebook on `P00_student.m4a`.

Claude, when you are back:

- [x] Run the tool on the P00 files and fix anything that breaks.
- [x] Update the system's IT1010 questions in `app/domain/c3_bank.py` to match the viva script.
      Done 12 Oct, loaded with `--update` (backup in `C4-db-backups`).

## While you wait for students (Tue 13, Wed 14)

- [x] Last recruiting push; send each student their code and the form; check answers as they
      come in (quiz 7 or more; statement average 3.5 or more, or 2.5 or less); fill their row.
- [x] Prepare the observer forms (one per student, printed or digital).
- [x] Read the script aloud once, with the lead-ins ("The first question is: ...", "Thank you.
      The next question is: ...") and the cards, so the real vivas run smoothly.
- [ ] Start the slides that need no results: the problem, why fillers alone are not enough,
      research question and hypotheses, method, limitations, PP2 plan.
- [ ] Draft the method part of any PP1 progress report your batch needs (participants, ethics,
      form and quiz, viva procedure, measures, counting check).

## Done on Sun 11 and Mon 12 Oct (Claude)

- [x] P00 analysed with CrisperWhisper (26 fillers found; the laptop transcriber found 4).
- [x] New measures: repairs (repeats, false starts, self-corrections), lexical fillers, word
      searches, more filler sounds (eh, ehm, mhm, aa); laughter tags ignored.
- [x] Counting check: pauses of 1 s or more (Audacity), repairs added, your typed counts kept on
      rerun; no CrisperWhisper file means fillers and repairs are left blank, never 0.
- [x] Statistics: case and spaces in `participants.csv` ignored; P00 always left out.
- [x] Speech lab: optional CrisperWhisper words file; new measures shown.
- [x] Viva app: one constant Groq voice, slim mic waveform, microphone check, "Slower" button,
      question dots, "Thank you" line between questions, finish celebration.
- [x] `practice-script.md` (role-play for practice runs); runsheet: lead-ins, strict turn rule.

## The research in five lines

1. **Question:** when knowledge is controlled, which speech measures separate Sri Lankan students
   who have communication difficulty in English technical vivas from those who do not, and at
   what thresholds?
2. **Students:** 5 who say English makes vivas hard + 5 who are comfortable; all pass a 10-question MCQ.
3. **Viva:** you ask 5 Programming Fundamentals (IT1010) questions in an online call (Zoom
   preferred) from a fixed script; an observer rates each answer; each voice is saved separately.
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

- [x] Read the files in `research/c4-viva/study/` (30 minutes). Tell me anything to change.
- [x] Check the 5 viva questions (`study/viva-script.md`) and the MCQ (`study/mcq.md`) yourself:
      are they at the right level for your batch? Done 9 Oct: new IT1010 script, MCQ aligned.
- [x] Ask 10 students (5 who find explaining in English hard, 5 who are comfortable). Message:
      > Hi! I'm doing a 25-minute study for my final-year research: a short online form and a
      > 10-minute practice viva on programming in an online call, in English. It does not affect
      > your course marks and there is nothing to prepare. Could you help on Mon 12, Tue 13 or
      > Wed 14 Oct?
- [x] Find an **observer** (a friend or teammate) free for the session slots. Ready (12 Oct).

## Fri 9 Oct

You:

- [x] Build the Google Form from `study/google-form.md` (about 1 hour): the short consent
      (type your name, SLIIT email and your supervisor's name where it says so), background,
      the 3 statements, the quiz with the answer key from `study/mcq.md`. Turn off "Collect
      email addresses". Built 9 to 10 Oct; new Section 1 text and tests still to do (catch-up 2).
- [x] Ethics form drafted and turned into a PDF (`study/ethics-preliminary-form.md`); signing and
      upload still to do (catch-up 1).
- [x] Give each student a code (P01 to P12) privately; send them the form after ethics approval;
      ask them to finish within a day.
- [x] Zoom desktop app: turn on the two settings in `study/zoom-setup.md`.
- [x] Create the recordings folder and `participants.csv` (in `Research Data/`, see the catch-up list).

Claude:

- [x] Put the literature profile into the system's gap rule (new rule version, tests), so the
      system and the research use the same thresholds. Done 9 Oct: gap rules
      `c04-gap-1.4-literature-profile` (spec-domain.md section 6); 92 tests pass.
- [x] Test the private, local transcriber (works with `base.en`; the default `small.en`
      downloads about 0.5 GB on first use). Still to time on a real 10-minute file.

## Sat 10 Oct

You:

- [x] **Practice viva** (10 minutes, not part of the results): a test run with a friend
      playing the student, to check that Zoom records both voices and that the analysis tool
      works on a real recording before the real sessions. Ask the 5 questions from the script,
      record, then rename the two audio files Zoom saves to `P00_student.m4a` and
      `P00_examiner.m4a` and put them in `Documents/viva-study/recordings`. Tell me "practice
      files are in"; I run the tool on them and fix anything that breaks.
- [x] Optional: try the Colab notebook with `P00_student.m4a`.

Claude:

- [x] Check the practice results; fix anything that looks wrong (question splitting, pauses,
      fillers). Done 11 and 12 Oct.
- [x] "Analyse a recording" page in the viva system: upload a recording, see the measures
      against the thresholds. This links your research to your system for the PP1 demo.
      Done 8 Oct: **Speech lab** in the staff menu (admin only); see UI-UPGRADE-2026-10.md.

## Sun 11 Oct

You:

- [x] From the form answers: average the 3 statements per student; 3.5 or more = difficulty,
      2.5 or less = comfortable; MCQ 7/10 or more. Pick 5 + 5 (+ spares). Fill
      `participants.csv` (code, group, mcq_score, self_report).
- [x] Book the sessions: 3 or 4 a day, Tue 13 to Wed 14 (Thu 15 morning at the latest). Send each student the Zoom link and the
      "Tell each student" part of `study/zoom-setup.md`.
- [x] Confirm the observer's times; prepare one observer form per student.

Claude:

- [x] Finish the demo page (12 Oct: words file and new measures in the Speech lab).
- [ ] Prepare the slide chart layout (with the real charts, Sat 17).

## Tue 13 and Wed 14 Oct: the vivas (follow `study/viva-runsheet.md`)

For **each** session (about 25 minutes):

All 10 sessions done (13 to 16 Oct); P04 re-placed with the proper recording on 17 Oct.

- [x] 10 minutes before: Zoom open, earphones on, script and observer form ready.
- [x] Student and observer join; both click **Original sound**.
- [x] Opening lines (not recorded), then **Record on this computer**, say "Participant P0X".
- [x] Warm-up (always, first, recorded), then the 5 questions; follow-ups by the rule; only "Take your time" while the student answers; never pause the recording.
- [x] "That is the end of the viva. Thank you." Stop recording; optional self-rating questions.
- [x] End the meeting; rename the two files to `P0X_student.m4a` and `P0X_examiner.m4a`; move them
      to the recordings folder. Back up to a USB drive: **still to confirm**.
- [x] Add the observer's overall answer and any notes to `participants.csv`.

Each evening:

- [x] Tell me "sessions done" (or "P01 done"); I run a quick check on the day's files: both
      tracks there, the right number of answers, no voice bleed. Colab waits until Thu 15.

## Thu 15 Oct

You:

- [x] Colab: upload all `*_student.m4a` files to `analysis/crisperwhisper_colab.ipynb`, Run all,
      download `words.zip`, unzip it into the recordings folder. Then tell me; I re-run the tool.
- [x] **Counting check:** open `results/count_check.csv`. For each student, play the given
      minute (`listen_from` to `listen_to` in `listen_in`); by ear, tick each "um"/"uh" and each
      repair (a repeat like "the the", a cut-off word, or "sorry, I mean"). Ears cannot time
      pauses, so count those in desktop Audacity (not the browser version): select the same
      minute, Analyze, Label Sounds: threshold -40 dB, Peak level, minimum silence 1.000 s,
      minimum label interval 0, Region around sounds. Pauses = number of labels minus 1 (the gaps
      between them; the silence after the last label does not count). Type the totals into `your_fillers`, `your_repairs` and
      `your_pauses_1s` in Notepad (Excel changes the times and locks the file). About 30
      minutes in total. Rerunning the tool keeps what you typed, and once you have typed counts
      it measures the tool's counts over the `listen_from` to `listen_to` you typed.

Claude:

- [x] Compare CrisperWhisper with Groq/local transcripts (filler counts) for your report. Done 17
      Oct on P01 to P10 except P04: local Whisper (with the filler prompt) found 20 fillers,
      CrisperWhisper 303, so ordinary Whisper keeps about 7%. Groq not tested on study audio
      (consent does not cover sending it to Groq).
- [x] Counting check result (17 Oct, your pauses = Audacity labels minus 1): fillers within 1 of
      your count for 9 of 10 students (rho 0.98), repairs 8 of 10 (rho 0.75), pauses 8 of 10
      (rho 0.99). Tool counts more pauses for the two slowest speakers (P04, P05).

## Fri 16 Oct

- [x] Claude runs `run_stats.py`: `results/report.md`, `summary.csv` and charts.
- [ ] You and Claude read the report together. I explain every number in plain words. We
      write down the pilot cut-offs to show next to the literature ones. Half done 17 Oct: the
      pilot cut-offs are recorded (speech rate 2.53, articulation 3.59, run 5.73, pause 682.5 ms;
      `fluency.PILOT_PROFILE`); pilot rule 10 of 10, literature rule 3 of 5 difficulty and 0 of
      5 comfortable. The plain-words walk-through of `report.md` is still to do.

## Sat 17 and Sun 18 Oct

You:

- [ ] Mon 19 Oct: show the system to your supervisor and collect ideas (system work finished first).
- [ ] Slides (on hold until after the supervisor meeting) (outline in section 18 of the plan): the problem; why fillers alone are not enough;
      research question and hypotheses; method; system demo; measures; literature vs pilot
      thresholds; results; limitations; PP2 plan.
- [ ] Any PP1 progress-report text your batch requires (method and preliminary results).

Claude:

- [x] Pilot thresholds in the system (17 Oct): gap rules `c04-gap-1.5-pilot-profile`; the Speech
      lab shows the pilot and literature verdicts side by side; 115 tests pass.
- [ ] Draft slide text and speaker notes from the real results; check every number.
- [ ] Charts for the slides from `results/charts/`.
- [x] Filler detector moved to PP2 (decided 17 Oct): a Colab notebook that trains a small
      filler detector on PodcastFillers' 76,689 labelled 1-second clips, adapted with the
      CrisperWhisper filler times from your recordings, then added to the live viva. Show it to
      your supervisor as the PP2 plan.

## PP2 list (from 17 Oct)

- [ ] Filler detector (above), so the live viva counts fillers; dataset search prompt given 17 Oct.
- [ ] Test the pilot cut-offs on new students (Speech lab or the analysis tool).
- [ ] Live syllable counts: Groq transcripts drop repeats and cut-off words (5 to 15% fewer
      syllables than CrisperWhisper on the pilot data), so live speech rates read slightly slow.

## Mon 19 Oct

- [ ] Supervisor meeting (system shown, ideas collected).
- [ ] Full dry run (Tue 20): give the whole presentation once with a timer, including the live
      system, to check the timing and catch problems.
- [ ] Code freeze: commit and push (I give you the commands).

## Tue 20 Oct

- [ ] Spare day for anything that slipped. Nothing new.

## Wed 21 Oct: PP1

## Definition of done for PP1

- [x] Ethics form submitted (done 11 Oct); consent given by every participant (form consent, confirmed 17 Oct)
- [x] At least 5 + 5 recorded vivas with results
- [x] Counting check filled in
- [x] `report.md` with group differences, literature vs pilot thresholds, leave-one-out accuracy
- [x] System demo: viva prototype, plus the "Analyse a recording" page using the thresholds
- [ ] Slides rehearsed; code committed and pushed (7e70eb9 pushed 17 Oct;
      the pilot-threshold change after it is not committed yet)

## If something goes wrong

| Problem | What to do |
|---|---|
| Ethics form is slow | Ask your supervisor what PP1 may show; run only the practice viva until it is cleared |
| Fewer than 5 + 5 students | Present what you have as a feasibility pilot; collect the rest in PP2 |
| Colab has no GPU | Use `--transcriber groq` (fast) or `--transcriber local` (private, slower) |
| A recording failed | Re-run that student's viva if possible; otherwise note it and continue |
| Results show no difference | That is still a valid finding for a pilot; report effect sizes and what PP2 changes |
