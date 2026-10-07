export { BaselineCalibrator, type BaselineOptions, type BaselineStats } from './baseline.js';
export {
  FeaturePipeline,
  type CalibrationPhase,
  type FeaturePipelineOptions,
  type FrameFeatures,
  type NormalisedSecond,
  type PipelineState,
} from './feature-pipeline.js';
export { FeatureWindow, type ModelInput, type WindowRow } from './feature-window.js';
export { PresenceTracker, type Presence } from './presence.js';
export { ReferenceTracker, RollingMedian, type ReferenceValues } from './references.js';
export {
  SecondAggregator,
  type FrameObservation,
  type SecondAggregatorOptions,
  type SecondAux,
  type SecondFeatures,
} from './second-aggregator.js';
