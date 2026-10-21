export type Mode = "casual" | "analyst";
export type XY = [number, number];

export interface PlayerInfo { id: string; team: "home" | "away"; number: number; name: string; role: string; x: number; y: number }
export interface Frame { t: number; ball: XY; p: Record<string, XY> }
export interface Leaf {
  leaf_id: string; end_reason: "shot" | "turnover" | "out_of_play" | "timeout"; probability: number;
  elapsed_s: number; shot_quality: number | null; initial_pass_completed: boolean | null; possession_lost: boolean;
}
export interface Metrics { p_complete: number | null; p_lose_possession: number; q_shot: number | null; opportunity_value: number }
export interface Branch {
  action_id: string; label: string; type: "pass" | "shot"; actor_id: string; receiver_id: string | null; target: XY;
  metrics: Metrics; inputs: Record<string, number | string | null>; outcome_tree: { root: string; leaves: Leaf[] };
  representative_leaf: string; events: Array<Record<string, unknown> & { t: number; type: string }>;
  frames_ref: string; metric_evidence_ids: string[];
}
export interface Claim {
  claim_id: string; subject: { scenario_id: string; variant_id: string; action_id: string }; metric_name: string;
  raw_value: number; unit: string; display_value: string; label: string; evidence_id: string; definition_version: string; time_window_s: number;
}
export interface Explanation {
  action_id: string; variant_id: string; verdict: "strongest" | "close" | "weaker"; focus: string;
  casual: { headline: string; sentence: string; metric_claim_ids: string[]; uncertainty: string };
  analyst: { headline: string; sentence: string; lines: Array<{ action_id: string; claim_ids: string[] }>; compare: { action_id: string; claim_id: string } | null; assumptions: string[] };
  claims: Claim[]; llm_status: string;
}
export interface Evidence { evidence_id: string; metric_name: string; value: number; unit: string; display_value: string; label: string; definition: string; source_kind: string; subject: Claim["subject"] }
export interface Intervention {
  intervention_id: string; variant_id: string; label: string; subject_id: string;
  field_changes: Array<{ field: string; before: unknown; after: unknown }>; base_state_hash: string;
}
export interface Bundle {
  schema_version: string; bundle_id: string; scene_id: string; scenario_version: string; variant_id: string;
  title: string; brief: string; tactic: string; clock: string; score: { home: number; away: number };
  teams: { home: { short: string; name: string; color: string }; away: { short: string; name: string; color: string } };
  horizon_s: number; state_hash: string; base_state_hash: string; carrier_id: string; key_defender_ids: string[];
  players: PlayerInfo[]; intervention: Intervention | null;
  available_interventions: Array<{ intervention_id: string; variant_id: string; label: string; subject_id: string }>;
  recorded_action_id: string; recorded_action_note: string; leadin: { dt: number; frames: Frame[] };
  branches: Branch[]; focus: string; explanations: Record<string, Explanation>; evidence: Record<string, Evidence>;
  metric_definitions: Record<string, { label: string; unit: string; definition: string }>;
  generation: { mode: string; cache_status: string; run_id: string; engine_version: string; policy_version: string; generated_at: string };
  validation: { status: string; qa_status: string; revisions: number };
}
export interface Motion { action_id: string; variant_id: string; dt: number; leaf: string; frames: Frame[] }
export interface Catalog {
  schema_version: string; engine_version: string; generated_at: string;
  scenes: Array<{ scene_id: string; title: string; brief: string; clock: string; scenario_version: string; heldout: boolean;
    variants: Array<{ variant_id: string; status: string; run_id?: string; label?: string }> }>;
}
export interface Trace {
  run_id: string; framework: string; framework_package: string; actual_model_ids: Record<string, string>;
  result: string; qa_status: string; revisions: number; fault_injection: boolean; label?: string;
  steps: Array<{ i: number; agent: string; intent: string; detail: unknown }>;
  tool_calls: Array<{ agent: string; tool: string; args: Record<string, unknown>; result: Record<string, unknown>; ms: number }>;
}
