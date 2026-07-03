export type CellValue = string | number | boolean | null;
export type DataRow = Record<string, CellValue>;

export interface RoundRow extends DataRow {
  match_number: number;
  match_id: string | null;
  played_at_jst: string | null;
  match_result: string | null;
  target_score: number | null;
  opponent_score: number | null;
  target_id: string | null;
  target_username: string | null;
  opponent: string | null;
  opponent_id: string | null;
  round: number;
  round_won: boolean;
  opponent_round_won: boolean | null;
}

export interface MatchRow extends DataRow {
  match_number: number;
  match_id: string | null;
  played_at_jst: string | null;
  opponent: string | null;
  opponent_id: string | null;
  match_result: string | null;
  target_score: number | null;
  opponent_score: number | null;
  won: boolean;
  completed: boolean;
  analysis_eligible: boolean;
  round_count: number;
}

export interface MonthlyRow {
  month: string;
  matches: number;
  wins: number;
  losses: number;
  official_win_rate: number | null;
  expected_win_rate: number | null;
  expected_excess_rate: number | null;
  tr_start: number | null;
  tr_end: number | null;
  tr_change: number | null;
  peak_tr: number | null;
  max_drawdown: number | null;
  [key: string]: CellValue;
}

export interface TiebreakRow {
  match_number: number;
  played_at_jst: string | null;
  won: boolean;
  expected_win: number | null;
  route: string;
  penultimate_won: boolean;
  min_lead_before_final: number;
  max_lead_before_final: number;
  final_lifetime_s: number | null;
  [key: string]: CellValue;
}

export interface Summary {
  schema_version: "2.0.0";
  source: {
    username: string;
    fetched_at: string;
    max_matches: number | "all";
    rows: {
      records: number;
      matches: number;
      rounds: number;
    };
    truncated?: boolean;
    cached_until?: number | null;
  };
  session_definition: {
    gap_minutes: number;
    gap_basis: string;
    same_session_rule: string;
    match_end_estimate: string;
    fallback: string;
  };
  meta: Record<string, unknown>;
  kpis: Record<string, unknown>;
  recent_windows: Array<Record<string, unknown>>;
  metrics: Record<string, Record<string, number | null>>;
  metrics_recent: Record<string, Record<string, number | null>>;
  current_league: {
    source: "summaries/league";
    available: boolean;
    raw: {
      APM: number | null;
      PPS: number | null;
      VS: number | null;
      TR: number | null;
      Glicko: number | null;
      RD: number | null;
      gameswon: number | null;
      gamesplayed: number | null;
      rank: string | null;
    };
    derived: Record<string, number | null>;
  };
  recent_scope: Record<string, number>;
  growth_window_n: number;
  growth: Record<string, unknown>;
  growth_windows: Array<Record<string, unknown>>;
  stability: Record<string, unknown>;
  monthly_changes: Record<string, unknown>;
  effect_sizes: Array<Record<string, unknown>>;
  delta_metric_bins: Record<string, Array<Record<string, unknown>>>;
  delta_vs_bins: Array<Record<string, unknown>>;
  dominance: Array<Record<string, unknown>>;
  pps_vs_dominance: Array<Record<string, unknown>>;
  model: {
    baseline: Record<string, number | string | null>;
    valid_n: number;
  };
  styles: Record<string, unknown>;
  styles_recent: Record<string, unknown>;
  tr_gap: Array<Record<string, unknown>>;
  drawdown: Record<string, unknown>;
  streaks: Record<string, unknown>;
  streak_states: Array<Record<string, unknown>>;
  psychology: Record<string, unknown>;
  tiebreak: Record<string, unknown>;
  session_positions: Array<Record<string, unknown>>;
  session_dynamics: Record<string, unknown>;
  excess_by_weekday: Array<Record<string, unknown>>;
  excess_by_hour: Array<Record<string, unknown>>;
  duration_bins: Array<Record<string, unknown>>;
  duration_by_result: Record<string, unknown>;
  score_states: Array<Record<string, unknown>>;
  pps_bins: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  rank_journey: Record<string, unknown>;
  session_decay: Array<Record<string, unknown>>;
  comeback: Record<string, unknown>;
  style_matchup_plane: Record<string, unknown>;
  rivals: Array<Record<string, unknown>>;
  replay_candidates: Array<Record<string, unknown>>;
}

export interface AnalysisBundle {
  rounds: RoundRow[];
  matches: MatchRow[];
  monthly: MonthlyRow[];
  tiebreakRounds: TiebreakRow[];
  summary: Summary;
}
