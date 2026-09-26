/**
 * The only file other features may import from.
 * Architecture Section 6: features never reach into each other's internals.
 */
export { curriculumRoutes } from './routes';
export type { Concept, Module, ModuleConcepts, Topic } from './api/curriculumApi';
