# 3. METHODOLOGY

## 3.1 Research Design

This research adopts an **experimental design with controlled ablation**, supplemented by a small-cohort quasi-experimental study for the learning-outcome comparison. The choice follows from the nature of the research questions, the type of data available, and the experimental requirements each question imposes.

The research questions established in Section 1.3 are comparative rather than descriptive. They do not ask what a faithfulness-verified tutor does; they ask whether verification at claim level detects unsupported content that whole-response verification misses, and whether mastery-gated progression produces different learning outcomes from points-based progression. Questions of this form require a controlled condition and a manipulated condition measured on the same inputs, which is the defining property of an experimental design. A descriptive or purely observational design could characterise system behaviour but could not attribute any observed difference to the mechanism under test.

Ablation is the specific experimental form adopted because the manipulated variable in three of the four research questions is the presence or configuration of a pipeline component. Removing the faithfulness gate, substituting whole-response verification for claim-level verification, and replacing mastery-gated unlocking with points-based unlocking each isolate one mechanism while holding the remainder of the pipeline constant. This mirrors accepted practice in the faithfulness-verification literature: SummaC establishes the superiority of sentence-level over document-level NLI by evaluating both granularities on identical benchmark inputs [14], and FaithScore validates decomposition by comparing atomic-fact scoring against whole-response scoring on the same generated outputs [13]. Applying the same comparative structure to educational artefacts keeps this research's results directly commensurable with the precedent it extends.

The learning-outcome question cannot be addressed by ablation over system outputs, since its unit of analysis is a student rather than a generated artefact. It is therefore addressed through a **quasi-experimental pre-test/post-test comparison** between a mastery-gated condition and a points-only condition. The design is quasi-experimental rather than fully randomised because cohort size within a final-year project timeline does not support randomisation with adequate statistical power; this limitation is stated explicitly rather than concealed, and results are reported as effect size and direction rather than as significance claims.

The dominant data type in this research is **generated text paired with retrieved evidence**, labelled for entailment. This is categorical classification data, appropriate to precision, recall, and F1 analysis against a ground-truth set. The secondary data type is **timing data** from the verification pipeline, appropriate to descriptive latency analysis against a defined interactive threshold. The tertiary data type is **assessment scores** from student participants, appropriate to pre/post gain analysis. Each research question is matched to the data type capable of answering it.

---

## 3.2 Data, Participants and Experimental Inputs

Three distinct inputs are required. Each is described by source, preparation, and rationale.

### 3.2.1 Course content corpus

**Source.** Theory content for two to three prerequisite-linked IT/CS modules, authored by the researcher rather than ingested from existing lecture material. The first module is Data Structures and Algorithms, comprising seven topics across twenty-four theory units; the second extends into Dynamic Programming, for which Recursion and Divide-and-Conquer are the direct prerequisites.

**Preparation.** Content is authored as structured units containing text, code snippets, and diagrams. Each unit is tagged with the concept identifiers it covers and a difficulty tag, then chunked and embedded into a module-namespaced vector store.

**Why appropriate.** Authoring rather than ingesting serves three purposes. It eliminates transcript noise that would confound retrieval quality with generation quality, making any observed hallucination attributable to the generation and verification stages rather than to poor source material. It removes copyright and licensing dependency. And it establishes unambiguous ground truth: because the researcher authored every source passage, entailment judgements during labelling are made against material of known content, which is a precondition for a reliable faithfulness dataset.

**Selection rationale.** Module selection is informed by the requirements survey described in Section 5, specifically the items identifying which topics students find most difficult and which prerequisite pairs they experience as most tightly coupled. Selecting modules on survey evidence rather than convenience means the evaluation cohort is working on content they have independent reason to find challenging.

### 3.2.2 Claim-level faithfulness evaluation set

No public dataset exists for claim-level faithfulness in generated educational content. Existing resources address adjacent domains: RAGTruth provides a hallucination corpus for general RAG outputs [4], FaithScore addresses vision-language grounding [13], and SummaC addresses summarisation [14]. None covers generated practicals, quest scenarios, or grading rationale. Constructing this dataset is therefore a prerequisite for evaluation and, as stated in Objective 6, a research output in its own right.

**Composition.** Approximately 180 generated outputs, distributed evenly across the three generation modes (tutoring sessions, generated practicals, grading rationale). At an expected five to ten atomic claims per output, this yields approximately 900 to 1,800 claim-level judgements.

**Generation conditions.** Roughly 60% of outputs are generated under normal retrieval conditions and 40% under deliberately degraded retrieval. Degradation is applied through three controlled manipulations: restricting retrieval to the single top-ranked chunk, retrieving from an incorrect module namespace, and disabling retrieval entirely. This is necessary because a correctly functioning grounded pipeline produces unsupported claims at a low base rate, and a dataset drawn only from natural generation would be too class-imbalanced to measure detection recall meaningfully. Results are reported separately for the two conditions so that natural and induced hallucination rates remain distinguishable.

**Labelling procedure.** Each atomic claim is labelled against its corresponding retrieved passage as *supported*, *contradicted*, or *not supported*. Four controls apply:

1. A written annotation guideline is produced **before** labelling begins, specifying the decision rule for each label with three to four worked examples per generation mode. This guideline is included as an appendix.
2. Labelling is performed **blind** to the pipeline's own verification decision. Claims are shuffled and presented with the retrieved passage alone, with no indication of whether the gate passed or blocked them, preventing labels from drifting toward agreement with the system under test.
3. A 15% random subset is **re-labelled after an interval of two to three weeks**, and intra-annotator agreement is reported as Cohen's κ.
4. Where a second annotator is available from the project team, a 10% overlap subset is labelled independently and inter-annotator agreement is additionally reported.

**Why appropriate.** Claim-level labels are the only data type capable of answering the granularity question. A whole-response faithfulness score cannot establish whether claim-level verification catches localised unsupported content, because it does not record where within a response the failure occurred.

### 3.2.3 Student participants

**Sample.** A small cohort of undergraduate IT/CS students, recruited from within the institution, split between the mastery-gated and points-only conditions for the learning-outcome comparison and additionally providing usability feedback.

**Collection method.** Pre-test administered before module engagement, platform interaction logged across sessions, post-test administered after module completion. Behavioural data captured includes checkpoint outcomes, session exit states, hint usage, and attempt counts.

**Ethical clearance.** Obtained under the wider AdaptLearn project. Participation is voluntary and withdrawable. Informed consent covers platform interaction logging, assessment data use, and the cross-component data flows described in Section 4. No raw webcam, video, or biometric data is received by this component at any stage; only the categorical load state and its confidence value are consumed.

**Why appropriate.** The learning-outcome question concerns human learning and cannot be answered from system outputs alone. The cohort size is acknowledged as a limitation on statistical power and is addressed in Section 3.5.

---

## 3.3 Baselines and Benchmarks

Each research question is evaluated against a named baseline representing current practice in the reviewed literature.

| Research question | Baseline | Basis in literature |
|---|---|---|
| Does claim-level faithfulness gating reduce unsupported content reaching the learner? | **Ungated grounded generation** - the same RAG pipeline with the verification gate disabled | KG-RAG [9] and LPITutor [10] both operate without an evaluated faithfulness gate, relying on grounding alone |
| Does claim-level verification outperform whole-response verification? | **Whole-response entailment scoring** - the full generated output verified as a single premise-hypothesis pair | The Moodle-integrated assistant evaluates faithfulness at whole-response granularity [5] using the Ragas framework [19] |
| Does mastery-gated progression improve learning outcomes over activity-based progression? | **Points-only gamification** - identical mechanics with unlocks driven by accumulated points rather than mastery | Duolingo Max treats a lesson as complete on submission rather than demonstrated mastery [15] |
| Does load-conditioned generation adapt output appropriately? | **Fixed-depth generation** - identical pipeline with the load signal ignored | Reviewed load-aware e-learning systems adapt pacing of fixed content rather than generated content [6] |
| Does the component remain functional without connectivity? | **Cloud-only generation** - the primary provider path | No reviewed system reports a fallback generation path [5], [9], [10] |

Selecting baselines that correspond to specific reviewed systems rather than to arbitrary alternatives means each result is directly interpretable as a comparison against current practice, and each maps to a gap identified in Section 1.3.

**Model selection benchmark.** Candidate NLI entailment models are compared against one another on the labelled evaluation set rather than fixed in advance. Candidates include DeBERTa-v3-based classifiers [11] and Vectara's HHEM [12]. Selection is made on measured entailment accuracy and per-claim latency, with the 512-token input constraint of the lightweight candidate [12] treated as a measured limitation rather than an assumed disqualification.

---

## 3.4 Evaluation Metrics

| Metric | Why relevant | Target / Comparison |
|---|---|---|
| Unsupported-claim rate (%) | Direct measure of hallucinated content reaching the learner, the primary risk this research addresses | Gate active vs gate disabled, reported separately for tutoring sessions, practicals, and grading |
| Detection recall | Tests the central novelty claim; a localised unsupported clause inside an otherwise faithful response is precisely what whole-response scoring misses | Claim-level recall > whole-response recall on identical outputs |
| Detection precision and F1 | Guards against the failure mode of over-blocking valid content to inflate recall | Reported alongside recall; precision must not degrade materially |
| NLI entailment accuracy | Justifies model selection as an evaluated decision rather than an assumed default | Candidate models compared against the labelled evaluation set |
| Per-claim verification latency (ms) | Non-functional requirement in Section 4.2 demands interactive responsiveness; decomposition adds cost that must be quantified | Total added latency vs whole-response verification, against a defined interactive threshold |
| Explanation-depth adaptation accuracy | Tests generation-time load conditioning, the second novelty claim | Generated depth, length, and scaffolding density vs load label, across low, moderate, and high states |
| Learning gain (pre/post) | Tests mastery-gated vs activity-based progression, the third novelty claim | Effect size and direction between conditions; significance not claimed at this sample size |
| Offline functional parity | Non-functional availability requirement | Faithfulness rate and output quality, cloud provider vs local fallback |
| Intra-annotator agreement (Cohen's κ) | Establishes that the ground-truth labels underpinning every other metric are reliable | Reported on a 15% re-labelled subset |
| Retrieval precision and recall | Isolates retrieval quality from generation quality, so hallucination is not misattributed | Measured against held-out concept queries before generation logic is evaluated |

Metrics are grouped so that each novelty claim in Section 1.3 is answered by at least one primary metric and one guard metric. Recall is paired with precision, faithfulness gain is paired with latency cost, and learning gain is paired with an honest statement of statistical limitation. Reporting a primary metric without its guard would overstate the result.

---

## 3.5 Validation Strategy

Validity is addressed at four levels.

**Construct validity - are the labels measuring what they claim to?** The ground-truth labels underpin every faithfulness result, so their reliability is established before any result derived from them is reported. This is done through the written annotation guideline produced prior to labelling, blind labelling that prevents alignment with the system under test, and reported intra-annotator agreement on a re-labelled subset. Cohen's κ is the accepted statistic for annotation reliability and is reported regardless of its value.

**Internal validity - is the observed difference attributable to the mechanism?** Ablation holds the entire pipeline constant except the manipulated component, so a difference in unsupported-claim rate between gated and ungated conditions cannot be attributed to a difference in retrieval, prompting, or model. The claim-level versus whole-response comparison is run on identical generated outputs rather than on separately generated sets, following the comparative structure established by SummaC [14].

**External validity - do the results generalise?** They generalise to the tested scope and no further, and this is stated explicitly. Findings apply to two to three IT/CS modules of authored theory content, a single institution, and a single annotator. The learning-gain comparison in particular is scoped to one within-project cohort; a multi-institution study would be required to establish generalisability, and this is identified in the Future Scope section rather than claimed here.

**Ecological validity - do the latency figures reflect real use?** Verification latency is measured under realistic session conditions, on outputs of the length the system actually produces, rather than on short synthetic inputs. This matters because long-form outputs such as boss-checkpoint scenarios and multi-criterion grading rationale are both where claim-level verification is expected to outperform whole-response checking and where its latency cost is highest.

**Reporting commitments.** Results are reported whether or not they support the hypothesis. If claim-level verification does not outperform whole-response verification on this content, or if the latency cost proves prohibitive for interactive use, that finding is reported as such. If the learning-gain comparison shows no difference at this sample size, the effect size and its confidence interval are reported rather than the result being omitted. The natural and induced hallucination conditions are always reported separately so that the base rate remains visible.

---

## 3.6 Development Approach

**Selected approach: Agile, using the Scrum framework.**

The choice follows from three properties of this project. First, the nature of the product is research-dependent: the NLI model, the claim-decomposition method, and the mastery-gating thresholds are all evaluated decisions whose outcomes are unknown at the outset, so a sequential approach that fixes them in a design phase would require rework each time an evaluation result contradicted an early assumption. Iterative sprints allow research findings to be integrated as they arrive. Second, the users are students whose interaction with a guided tutoring session cannot be fully specified in advance; incremental delivery permits usability feedback to shape the session design before it is finalised. Third, the project is one component of a four-component system with shared interface contracts, and Scrum's lightweight ceremony structure suits a small team coordinating around interface milestones rather than a single continuous codebase.

**Sprint sequencing.** The build order is determined by dependency and by risk rather than by architectural layer:

1. **Retrieval base first.** Course content is authored, chunked, embedded, and retrieval quality is validated before any generation logic is built on top of it. Building generation on unvalidated retrieval would make hallucination unattributable.
2. **Guided tutoring sessions second**, as the simplest of the three generation surfaces.
3. **Claim-level faithfulness gate third**, verified against a single well-understood generation mode before extension. Debugging the gate and an unfamiliar generation mode simultaneously is avoided deliberately.
4. **Practical and quest generator, then auto-grader**, reusing the same retrieval and verification logic rather than reimplementing verification per mode.
5. **Provider-agnostic generation layer in parallel with step 2**, since establishing the abstraction early avoids retrofitting it after cloud-specific assumptions have accumulated.
6. **Gamification engine and load conditioning** once the curriculum engine and load detection interfaces are available for integration testing. Both are developed against the agreed interface contract with stubbed signals in advance, so this component's progress does not block on another team member's delivery.
7. **Evaluation-set construction and ablation experiments**, scheduled explicitly as their own work items rather than folded into testing, since Objective 6 depends on them.

**Testing strategy.** Unit testing covers isolated logic independent of LLM calls: the chunking and embedding pipeline, the claim-decomposition step, the mastery-gating threshold logic, and the session state machine with its typed exit conditions. Integration testing validates retrieval against the vector store, generation under both provider paths, the faithfulness gate's interaction with each generation mode, and the interface contracts with the curriculum engine, load detection, and viva components, using stubbed signals where a dependent component is not yet available. System testing evaluates the pipeline end to end against the metrics in Section 3.4. User acceptance testing involves the student cohort described in Section 3.2.3, providing both usability feedback and the behavioural data required for the learning-gain comparison.

---

## Notes on what moved out of this section

| Previously in Section 3 | Now belongs in |
|---|---|
| System architecture (3.1) and diagrams | Section 4 - High-Level System Architecture |
| Requirement gathering | Section 5 - User Requirements |
| Feasibility study (economic, schedule, technical) | Retain as a short subsection here or fold into Section 7 - Budget, as supervisor prefers; the template does not require it |
| Commercialization (3.3) | Section 6 - Commercialization Plan |
| Future scope (3.4) | Retain as a closing subsection of the report, after Section 9 |
