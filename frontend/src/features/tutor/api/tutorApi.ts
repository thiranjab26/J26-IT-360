import { useQuery } from '@tanstack/react-query';

import { request } from '@/shared/api/client';

export interface Module {
  module_id: string;
  code: string | null;
  name: string;
  description: string | null;
  topic_count: number;
  concept_count: number;
}

export interface Concept {
  concept_id: string;
  name: string;
  description: string | null;
  topic_id: string;
  topic_name: string;
  prerequisite_ids: string[];
}

export interface Topic {
  topic_id: string;
  name: string;
  concepts: Concept[];
}

export interface ModuleConcepts {
  module: Module;
  topics: Topic[];
}

export function useModules() {
  return useQuery({
    queryKey: ['tutor', 'modules'],
    queryFn: () => request<Module[]>('/v1/tutor/modules'),
  });
}

export function useModuleConcepts(moduleId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'modules', moduleId, 'concepts'],
    queryFn: () => request<ModuleConcepts>(`/v1/tutor/modules/${moduleId}/concepts`),
    enabled: Boolean(moduleId),
  });
}
