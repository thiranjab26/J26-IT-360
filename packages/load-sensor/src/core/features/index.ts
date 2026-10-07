export {
  BlinkDetector,
  type BlinkOptions,
  type BlinkPhase,
  type BlinkUpdate,
  type EyeClosure,
} from './blink.js';
export { FEATURE_CONFIG, type FeatureConfig } from './config.js';
export { NodDetector, YawnDetector } from './drowsiness.js';
export { browInnerGap, browRaise, lipThickness, mouthOpen } from './expression.js';
export {
  earLeft,
  earRight,
  eyeAspectRatio,
  interocularDistance,
  irisOffset,
  type IrisOffset,
} from './eye.js';
export { computeFrameSignals, type FrameSignals } from './frame-signals.js';
export type { FaceMesh, Vec3 } from './geometry.js';
export { faceAxes, headPose, poseFromAxes, type FaceAxes, type HeadPoseDeg } from './head-pose.js';
export * as LANDMARKS from './landmark-indices.js';
export { FEATURE_LANDMARKS } from './landmark-indices.js';
export {
  FEATURE_COUNT,
  FEATURE_INDEX,
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  FEATURES,
  featureSpecBody,
  type FeatureDefinition,
  type FeatureGroup,
  type FeatureName,
} from './spec.js';
