// レポート匿名化。個人データ（対象プレイヤー名・対戦相手名/ID・リプレイリンク）を伏せる。
// 有効時は対象を「プレイヤー」、各対戦相手を出現順に「プレイヤーA」「プレイヤーB」…へ写像し、
// 同一相手には安定した同じラベルを割り当てる。無効時は素の値をそのまま返す。

export interface Anonymizer {
  readonly enabled: boolean;
  // レポート対象プレイヤーの表示名。
  subject(name: unknown): string;
  // ダウンロードファイル名などに使う対象プレイヤーの識別子（英数）。
  subjectSlug(name: unknown): string;
  // 対戦相手の表示名。同一相手には安定した「プレイヤーA」等を割り当てる。
  opponent(value: unknown, fallback?: unknown): string;
}

const SUBJECT_LABEL = "プレイヤー";
const SUBJECT_SLUG = "player";

// 0→A, 25→Z, 26→AA, 27→AB … と続く連番サフィックス。
function opponentSuffix(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function createAnonymizer(enabled: boolean): Anonymizer {
  const labels = new Map<string, string>();
  return {
    enabled,
    subject(name) {
      return enabled ? SUBJECT_LABEL : String(name ?? "");
    },
    subjectSlug(name) {
      return enabled ? SUBJECT_SLUG : String(name ?? "");
    },
    opponent(value, fallback) {
      const key = String(value ?? "").trim() || String(fallback ?? "").trim();
      if (!enabled) {
        return key;
      }
      if (!key) {
        return `${SUBJECT_LABEL}不明`;
      }
      let label = labels.get(key);
      if (!label) {
        label = `${SUBJECT_LABEL}${opponentSuffix(labels.size)}`;
        labels.set(key, label);
      }
      return label;
    },
  };
}
