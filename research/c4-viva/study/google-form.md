# Google Form text (send before the viva)

Create one Google Form. Settings: **turn off "Collect email addresses"**, make it a Quiz (for
section 4), and do not release scores immediately. Give each student their participant code
(P01 to P12) privately before they open the form.

## Build steps

1. forms.google.com, Blank form. Title: "Practice viva study (J26-IT-360)".
2. Settings: Make this a quiz ON; Release grades "Later, after manual review"; Collect email
   addresses OFF; Limit to 1 response OFF (it forces a Google sign-in).
3. Click the "Add section" icon to make sections 1 to 4 below; paste each title and description.
4. Section 4: add the 10 questions from `mcq.md` as Multiple choice, Required, 1 point each;
   click "Answer key" on each to mark the answer; ⋮ menu, "Shuffle option order".
5. Sections 1 to 3 questions: 0 points, no answer key.
6. Preview (eye icon), fill it in once as P00, then delete that test response
   (Responses tab, ⋮, Delete all responses).
7. Send, link icon, shorten URL. Send each student their code privately with the link.

## Section 1: Consent

**Title:** Practice viva study (SLIIT final-year research, J26-IT-360)

Paste this as the section description:

> This study looks at how students explain technical answers in English in a viva. You will
> fill in this form (about 15 minutes) and take a 10-minute practice viva on programming
> in an online call. Your answers and quiz score are used only for this study. They are not
> course marks and do not affect your grades. The short quiz checks that the questions suit you
> before the viva.
>
> You must be 18 or over and have completed Programming Fundamentals (IT1010).
>
> The call is recorded and only your voice is analysed. Recordings and results are kept on the
> researcher's password-protected laptop and an offline backup drive, never in shared or public
> storage, and may be transcribed by cloud tools (Groq, Google Colab). You are identified only by
> a code, never by name. All data is deleted at the end of the project (June 2027). Reports show
> only combined results, never individual students.
>
> You can stop at any time without giving a reason, and withdraw your data until it is analysed;
> your recording and results are then deleted.
>
> Researcher: [your name], [your SLIIT email]. Supervisor: [supervisor's name].

Question (required, multiple choice): "Do you agree to take part, and to the viva being
recorded and analysed as described?"

- Yes, I agree: go to section 2
- No: submit form (open the question's ⋮ menu, "Go to section based on answer")

## Section 2: Background

1. Participant code (given to you by the researcher): short answer
2. Year of study: Year 1 / Year 2 / Year 3 / Year 4
3. Have you completed the Programming Fundamentals (IT1010) module? Yes / No
4. First language: Sinhala / Tamil / English / Other
5. How would you rate your spoken English? 1 (weak) to 5 (strong)

## Section 3: Explaining in English (1 = strongly disagree, 5 = strongly agree)

1. In vivas I often stop or say "um" while searching for English words.
2. Even when I know a technical answer, I find it hard to explain it in English.
3. In vivas I lose marks because I cannot express what I know.

The average of the three decides the group: 3.5 or more = communication difficulty group;
2.5 or less = comfortable group; in between = choose a clearer volunteer if you can.

## Section 4: Quiz

The 10 questions in `mcq.md`, with the answer key set in the Quiz settings.

## Section 5: After the viva (optional, ask aloud or as a second short form)

1. I knew the answers to most questions. 1 to 5
2. Speaking in English made it harder to explain. 1 to 5
