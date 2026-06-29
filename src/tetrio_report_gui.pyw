#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""TETR.IO 戦績レポート作成 GUI ランチャー.

プレイヤーIDと取得試合数を入力し、ボタン一つで
「API取得 → パラメータ計算 → HTMLレポート生成 → 結果保存」までを実行する。

依存は Python 標準ライブラリ (tkinter) のみ。実際の処理は既存の
tetrio_league_export.py / make_report.ps1 を共有 venv で呼び出す。
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

# --- パス定義（このファイルは tetrio_report_app/src/ に置かれる） -----------------
SRC_DIR = Path(__file__).resolve().parent            # tetrio_report_app/src
APP_ROOT = SRC_DIR.parent                            # tetrio_report_app
EXPORT_SCRIPT = SRC_DIR / "api_export" / "tetrio_league_export.py"
EXPORT_OUTPUT_DIR = APP_ROOT / "data"
TEMPLATE_DIR = SRC_DIR / "report_builder"
MAKE_REPORT_PS1 = TEMPLATE_DIR / "make_report.ps1"
AI_CACHE_DIR = TEMPLATE_DIR / "cache" / "ai"
REQUIREMENTS = TEMPLATE_DIR / "requirements.txt"
VENV_DIR = TEMPLATE_DIR / ".venv"
VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
TEMPLATE_OUTPUT_DIR = TEMPLATE_DIR / "output"
RESULT_DIR = APP_ROOT / "reports"
CONFIG_PATH = APP_ROOT / "gui_config.json"
REQ_HASH_SENTINEL = TEMPLATE_DIR / "cache" / ".requirements.sha256"
PLACEHOLDER_USERNAME = "your_username"

# ② AI考察レポートの選択肢（表示ラベル <-> 内部値）。
AI_METHOD_CHOICES = [
    ("AIチャット用素材を保存", "manual_chat"),
    ("AIエージェントCLIで自動作成", "agent_cli"),
]
AI_QUALITY_CHOICES = [
    ("標準", "standard"),
    ("高品質", "high_quality"),
    ("低コスト", "low_cost"),
    ("従来JSON（ai_appendix_data）", "legacy_appendix"),
]
AI_AGENT_CHOICES = [
    ("Codex CLI", "codex"),
    ("Claude Code CLI", "claude"),
]
# 品質内部値 -> 保存するAI用JSONファイル名。
AI_QUALITY_SUMMARY = {
    "standard": "summary_standard.json",
    "high_quality": "summary_rich.json",
    "low_cost": "summary_compact.json",
    "legacy_appendix": "ai_appendix_data.json",
}

DEFAULT_CONFIG = {
    "username": PLACEHOLDER_USERNAME,
    "max_matches": 100,
    "fetch_all": False,
    "step_api": True,
    "step_report": True,
    "open_report": True,
    "save_csv": False,
    "save_base_files": False,
    "step_ai_report": False,
    "ai_report_method": "manual_chat",
    "ai_agent": "codex",
    "ai_quality": "standard",
}


def _label_to_value(choices: list[tuple[str, str]], label: str, fallback: str) -> str:
    for lab, val in choices:
        if lab == label:
            return val
    return fallback


def _value_to_label(choices: list[tuple[str, str]], value: str) -> str:
    for lab, val in choices:
        if val == value:
            return lab
    return choices[0][0]


class ReportLauncherApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("TETR.IO 戦績レポート作成")
        self.root.geometry("720x780")
        self.root.minsize(640, 660)

        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.worker: threading.Thread | None = None

        cfg = self._load_config()
        self._build_widgets(cfg)
        self.root.after(100, self._drain_log_queue)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------------ UI
    def _build_widgets(self, cfg: dict) -> None:
        pad = {"padx": 8, "pady": 4}
        frm = ttk.Frame(self.root, padding=12)
        frm.pack(fill="both", expand=True)
        frm.columnconfigure(1, weight=1)

        row = 0
        ttk.Label(frm, text="プレイヤーID (tetr.io ユーザー名)").grid(
            row=row, column=0, sticky="w", **pad
        )
        self.username_var = tk.StringVar(value=cfg["username"])
        ttk.Entry(frm, textvariable=self.username_var).grid(
            row=row, column=1, sticky="ew", **pad
        )

        row += 1
        ttk.Label(frm, text="取得試合数").grid(row=row, column=0, sticky="w", **pad)
        count_frame = ttk.Frame(frm)
        count_frame.grid(row=row, column=1, sticky="ew", **pad)
        self.max_matches_var = tk.IntVar(value=int(cfg["max_matches"]))
        self.spin = ttk.Spinbox(
            count_frame, from_=1, to=1_000_000, increment=50,
            textvariable=self.max_matches_var, width=12,
        )
        self.spin.pack(side="left")
        self.fetch_all_var = tk.BooleanVar(value=bool(cfg["fetch_all"]))
        ttk.Checkbutton(
            count_frame, text="取得できる全試合を対象にする",
            variable=self.fetch_all_var, command=self._toggle_all,
        ).pack(side="left", padx=12)
        self._toggle_all()

        row += 1
        steps = ttk.LabelFrame(frm, text="実行ステップ", padding=8)
        steps.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.step_api_var = tk.BooleanVar(value=bool(cfg["step_api"]))
        self.step_report_var = tk.BooleanVar(value=bool(cfg["step_report"]))
        self.open_report_var = tk.BooleanVar(value=bool(cfg["open_report"]))
        ttk.Checkbutton(
            steps, text="TETR.IOから戦績データを取得する",
            variable=self.step_api_var,
        ).pack(anchor="w")
        ttk.Checkbutton(
            steps, text="① 戦績レポート（本体・HTML）を作成する",
            variable=self.step_report_var, command=self._toggle_report_options,
        ).pack(anchor="w")
        self.step_ai_report_var = tk.BooleanVar(value=bool(cfg["step_ai_report"]))
        ttk.Checkbutton(
            steps, text="② AI考察レポートを作る",
            variable=self.step_ai_report_var, command=self._toggle_ai_report_options,
        ).pack(anchor="w")
        self.open_report_check = ttk.Checkbutton(
            steps, text="作成後にレポートをブラウザーで開く",
            variable=self.open_report_var,
        )
        self.open_report_check.pack(anchor="w")

        row += 1
        api_note = ttk.Label(
            frm,
            text=(
                "API取得は公開TETRA CHANNEL APIを使います。"
                "短時間の連続取得を避けてください。"
            ),
            foreground="#555555",
            wraplength=640,
            justify="left",
        )
        api_note.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)

        row += 1
        options = ttk.LabelFrame(frm, text="オプション", padding=8)
        options.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.save_csv_var = tk.BooleanVar(value=bool(cfg["save_csv"]))
        self.save_base_files_var = tk.BooleanVar(value=bool(cfg["save_base_files"]))
        ttk.Checkbutton(
            options, text="Parquetに加えてCSV形式でも保存する",
            variable=self.save_csv_var,
        ).pack(anchor="w")
        ttk.Checkbutton(
            options, text="派生指標を追加する前の元データも残す",
            variable=self.save_base_files_var,
        ).pack(anchor="w")

        row += 1
        self.ai_frame = ttk.LabelFrame(frm, text="② AI考察レポート設定", padding=8)
        self.ai_frame.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.ai_frame.columnconfigure(1, weight=1)

        ttk.Label(self.ai_frame, text="作成方法").grid(
            row=0, column=0, sticky="w", padx=4, pady=2
        )
        self.ai_method_var = tk.StringVar(
            value=_value_to_label(AI_METHOD_CHOICES, cfg["ai_report_method"])
        )
        self.ai_method_combo = ttk.Combobox(
            self.ai_frame, textvariable=self.ai_method_var, state="readonly",
            values=[lab for lab, _ in AI_METHOD_CHOICES],
        )
        self.ai_method_combo.grid(row=0, column=1, sticky="ew", padx=4, pady=2)
        self.ai_method_combo.bind(
            "<<ComboboxSelected>>", lambda _e: self._toggle_ai_report_options()
        )

        ttk.Label(self.ai_frame, text="品質").grid(
            row=1, column=0, sticky="w", padx=4, pady=2
        )
        self.ai_quality_var = tk.StringVar(
            value=_value_to_label(AI_QUALITY_CHOICES, cfg["ai_quality"])
        )
        self.ai_quality_combo = ttk.Combobox(
            self.ai_frame, textvariable=self.ai_quality_var, state="readonly",
            values=[lab for lab, _ in AI_QUALITY_CHOICES],
        )
        self.ai_quality_combo.grid(row=1, column=1, sticky="ew", padx=4, pady=2)

        ttk.Label(self.ai_frame, text="連携AIエージェントCLI").grid(
            row=2, column=0, sticky="w", padx=4, pady=2
        )
        self.ai_agent_var = tk.StringVar(
            value=_value_to_label(AI_AGENT_CHOICES, cfg["ai_agent"])
        )
        self.ai_agent_combo = ttk.Combobox(
            self.ai_frame, textvariable=self.ai_agent_var, state="readonly",
            values=[lab for lab, _ in AI_AGENT_CHOICES],
        )
        self.ai_agent_combo.grid(row=2, column=1, sticky="ew", padx=4, pady=2)

        self.ai_note = ttk.Label(
            self.ai_frame,
            text=(
                "「AIチャット用素材を保存」は、選択中の品質に対応するJSONとプロンプトを"
                "reportsフォルダーへ保存します。外部AIチャット上で②レポートHTMLを作れます。"
                "「AIエージェントCLIで自動作成」は、Codex CLI / Claude Code CLI を呼び出し、"
                "本文JSONから②AI考察レポートHTMLまで作ります。"
            ),
            foreground="#555555",
            wraplength=620,
            justify="left",
        )
        self.ai_note.grid(row=3, column=0, columnspan=2, sticky="w", padx=4, pady=2)

        self._toggle_report_options()
        self._toggle_ai_report_options()

        row += 1
        btns = ttk.Frame(frm)
        btns.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.run_btn = ttk.Button(btns, text="実行", command=self._on_run)
        self.run_btn.pack(side="left")
        ttk.Button(btns, text="ログをクリア", command=self._clear_log).pack(
            side="left", padx=8
        )

        row += 1
        frm.rowconfigure(row, weight=1)
        self.log = scrolledtext.ScrolledText(
            frm, height=16, state="disabled", wrap="word",
            font=("Consolas", 9),
        )
        self.log.grid(row=row, column=0, columnspan=2, sticky="nsew", **pad)

    def _toggle_all(self) -> None:
        self.spin.configure(
            state="disabled" if self.fetch_all_var.get() else "normal"
        )

    def _toggle_report_options(self) -> None:
        # ①または②のどちらかを作るならレポートを開くオプションを有効にする。
        any_report = self.step_report_var.get() or self.step_ai_report_var.get()
        self.open_report_check.configure(
            state="normal" if any_report else "disabled"
        )

    def _toggle_ai_report_options(self) -> None:
        on = self.step_ai_report_var.get()
        base_state = "readonly" if on else "disabled"
        self.ai_method_combo.configure(state=base_state)
        self.ai_quality_combo.configure(state=base_state)
        # 連携AIエージェントCLIは自動作成を選んだ場合だけ有効にする。
        method = _label_to_value(
            AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat"
        )
        agent_on = on and method == "agent_cli"
        self.ai_agent_combo.configure(state="readonly" if agent_on else "disabled")
        self.ai_note.configure(foreground="#555555" if on else "#aaaaaa")
        self._toggle_report_options()

    # ------------------------------------------------------------- config
    def _load_config(self) -> dict:
        cfg = dict(DEFAULT_CONFIG)
        if CONFIG_PATH.exists():
            try:
                cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
            except Exception:
                pass
        if "open_report" not in cfg and "step_save" in cfg:
            cfg["open_report"] = bool(cfg["step_save"])
        return cfg

    def _save_config(self) -> None:
        cfg = {
            "username": self.username_var.get().strip().lower(),
            "max_matches": self._safe_int(self.max_matches_var, 100),
            "fetch_all": self.fetch_all_var.get(),
            "step_api": self.step_api_var.get(),
            "step_report": self.step_report_var.get(),
            "open_report": self.open_report_var.get(),
            "save_csv": self.save_csv_var.get(),
            "save_base_files": self.save_base_files_var.get(),
            "step_ai_report": self.step_ai_report_var.get(),
            "ai_report_method": _label_to_value(
                AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat"
            ),
            "ai_agent": _label_to_value(
                AI_AGENT_CHOICES, self.ai_agent_var.get(), "codex"
            ),
            "ai_quality": _label_to_value(
                AI_QUALITY_CHOICES, self.ai_quality_var.get(), "standard"
            ),
        }
        try:
            CONFIG_PATH.write_text(
                json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            pass

    @staticmethod
    def _safe_int(var: tk.IntVar, fallback: int) -> int:
        try:
            return int(var.get())
        except Exception:
            return fallback

    # ------------------------------------------------------------- logging
    def _log_write(self, text: str) -> None:
        self.log_queue.put(text)

    def _drain_log_queue(self) -> None:
        try:
            while True:
                text = self.log_queue.get_nowait()
                self.log.configure(state="normal")
                self.log.insert("end", text)
                self.log.see("end")
                self.log.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log_queue)

    def _clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    # ------------------------------------------------------------- running
    def _on_run(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        username = self.username_var.get().strip().lower()
        if not username or username == PLACEHOLDER_USERNAME:
            messagebox.showwarning("入力エラー", "プレイヤーIDを入力してください。")
            return
        if not (
            self.step_api_var.get()
            or self.step_report_var.get()
            or self.step_ai_report_var.get()
        ):
            messagebox.showwarning(
                "入力エラー", "実行するステップを1つ以上選んでください。"
            )
            return

        self.username_var.set(username)
        self._save_config()
        self.run_btn.configure(state="disabled")

        params = {
            "username": username,
            "fetch_all": self.fetch_all_var.get(),
            "max_matches": self._safe_int(self.max_matches_var, 100),
            "step_api": self.step_api_var.get(),
            "step_report": self.step_report_var.get(),
            "open_report": self.open_report_var.get(),
            "save_csv": self.save_csv_var.get(),
            "save_base_files": self.save_base_files_var.get(),
            "step_ai_report": self.step_ai_report_var.get(),
            "ai_report_method": _label_to_value(
                AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat"
            ),
            "ai_agent": _label_to_value(
                AI_AGENT_CHOICES, self.ai_agent_var.get(), "codex"
            ),
            "ai_quality": _label_to_value(
                AI_QUALITY_CHOICES, self.ai_quality_var.get(), "standard"
            ),
        }
        self.worker = threading.Thread(
            target=self._run_pipeline, args=(params,), daemon=True
        )
        self.worker.start()

    def _finish(self) -> None:
        self.run_btn.configure(state="normal")

    # ----------------------------------------------------- subprocess util
    def _stream(self, cmd: list[str], cwd: Path) -> int:
        """子プロセスを実行し標準出力をログへ逐次転送。終了コードを返す。"""
        env = dict(os.environ)
        # UTF-8 モードを子プロセス全体へ伝播させる。これにより
        # full_update.py が内部で起動する build_report.py の出力デコード
        # （既定では cp932）も UTF-8 に統一され、UnicodeDecodeError を防ぐ。
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        self._log_write(f"\n$ {' '.join(cmd)}\n")
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
        except FileNotFoundError as exc:
            self._log_write(f"[エラー] 実行ファイルが見つかりません: {exc}\n")
            return 1
        assert proc.stdout is not None
        for line in proc.stdout:
            self._log_write(line)
        proc.wait()
        return proc.returncode

    # -------------------------------------------------------- environment
    def _python_exe(self) -> str:
        """共有 venv の python を返す（無ければ作成して依存を入れる）。"""
        if VENV_PYTHON.exists():
            self._ensure_requirements()
            return str(VENV_PYTHON)

        self._log_write("\n=== 初回準備: Python仮想環境(.venv)を作成します ===\n")
        launcher = self._base_python()
        rc = self._stream(launcher + ["-m", "venv", str(VENV_DIR)], cwd=TEMPLATE_DIR)
        if rc != 0 or not VENV_PYTHON.exists():
            raise RuntimeError("仮想環境の作成に失敗しました。")
        self._ensure_requirements(force=True)
        return str(VENV_PYTHON)

    def _ensure_requirements(self, force: bool = False) -> None:
        try:
            import hashlib

            current = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
        except Exception:
            current = ""
        installed = ""
        if REQ_HASH_SENTINEL.exists():
            installed = REQ_HASH_SENTINEL.read_text(encoding="ascii").strip()
        if not force and current and current == installed:
            return
        self._log_write("\n=== 依存パッケージを確認・インストールします ===\n")
        rc = self._stream(
            [str(VENV_PYTHON), "-m", "pip", "install", "-r", str(REQUIREMENTS)],
            cwd=TEMPLATE_DIR,
        )
        if rc == 0 and current:
            REQ_HASH_SENTINEL.parent.mkdir(parents=True, exist_ok=True)
            REQ_HASH_SENTINEL.write_text(current, encoding="ascii")

    @staticmethod
    def _base_python() -> list[str]:
        if shutil.which("py"):
            return ["py", "-3"]
        return ["python"]

    # ------------------------------------------------------------- pipeline
    def _run_pipeline(self, p: dict) -> None:
        try:
            python_exe = self._python_exe()

            player_id = p["username"]
            rounds_pq = (
                EXPORT_OUTPUT_DIR
                / f"{player_id}_tetra_league_rounds_with_params.parquet"
            )
            matches_pq = (
                EXPORT_OUTPUT_DIR
                / f"{player_id}_tetra_league_matches_with_params.parquet"
            )

            # --- API取得 ---
            if p["step_api"]:
                self._log_write("\n========== API取得 ==========\n")
                # クローン直後は data フォルダが未生成のため、サブプロセスの
                # 作業ディレクトリに指定する前に作成しておく（未作成だと
                # Popen が WinError 267 を出して起動に失敗する）。
                EXPORT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                cmd = [
                    python_exe, str(EXPORT_SCRIPT),
                    "--source", "api",
                    "--username", player_id,
                    "--outputs", "all" if p["save_csv"] else "parquet",
                    "--output-dir", str(EXPORT_OUTPUT_DIR),
                ]
                if not p["save_base_files"]:
                    cmd.append("--no-base-outputs")
                if p["fetch_all"]:
                    cmd.append("--all")
                else:
                    cmd += ["--max-matches", str(max(1, p["max_matches"]))]
                rc = self._stream(cmd, cwd=EXPORT_OUTPUT_DIR)
                if rc != 0:
                    self._log_write("\n[中断] API取得でエラーが発生しました。\n")
                    return

            # --- 戦績レポート生成（①本体は常に作成、②はオプション） ---
            if p["step_report"] or p["step_ai_report"]:
                self._log_write("\n========== 戦績レポート生成 ==========\n")
                if not rounds_pq.exists():
                    self._log_write(
                        f"\n[中断] 入力データが見つかりません: {rounds_pq}\n"
                        "先に「API取得」を実行してください。\n"
                    )
                    return

                ai_flags = ""
                if p["step_ai_report"]:
                    if p["ai_report_method"] == "agent_cli":
                        ai_flags = (
                            f" -GenerateAIReport -AIAgent {p['ai_agent']} "
                            f"-AIQuality {p['ai_quality']}"
                        )
                    else:
                        ai_flags = f" -PrepareAI -AIQuality {p['ai_quality']}"

                ps_inner = (
                    "$OutputEncoding=[Console]::OutputEncoding="
                    "[System.Text.Encoding]::UTF8; "
                    f"& '{MAKE_REPORT_PS1}' "
                    f"-DataFile '{rounds_pq}' "
                    f"-MatchesFile '{matches_pq}' "
                    f"-Player '{player_id}' "
                    "-Force"
                    f"{ai_flags}"
                )
                cmd = [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                    "-Command", ps_inner,
                ]
                # この実行で②HTMLが新規生成されたかを判定するための基準時刻。
                run_started = time.time()
                rc = self._stream(cmd, cwd=TEMPLATE_DIR)
                if rc != 0:
                    self._log_write("\n[中断] レポート生成でエラーが発生しました。\n")
                    return

                self._log_write(
                    "\n========== レポートをreportsフォルダーへ保存 ==========\n"
                )
                saved_report = self._copy_latest_report(player_id)
                saved_ai_report = None
                if p["step_ai_report"]:
                    saved_ai_report = self._copy_ai_outputs(
                        player_id, p, since=run_started
                    )

                if p["open_report"]:
                    if saved_report is not None:
                        self._open_file(saved_report)
                    if saved_ai_report is not None:
                        self._open_file(saved_ai_report)

            self._log_write("\n✅ 完了しました。\n")
        except Exception as exc:  # noqa: BLE001
            self._log_write(f"\n[例外] {exc}\n")
        finally:
            self.root.after(0, self._finish)

    def _copy_latest_report(self, player_id: str) -> Path | None:
        if not TEMPLATE_OUTPUT_DIR.exists():
            self._log_write("[警告] output フォルダーが見つかりません。\n")
            return None
        pattern = f"{player_id}_tetrio_performance_report_*.html"
        candidates = sorted(
            TEMPLATE_OUTPUT_DIR.glob(pattern),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            legacy_pattern = f"*_{player_id}_tetrio_performance_report.html"
            candidates = sorted(
                TEMPLATE_OUTPUT_DIR.glob(legacy_pattern),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
        if not candidates:
            candidates = sorted(
                TEMPLATE_OUTPUT_DIR.glob("*.html"),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
        if not candidates:
            self._log_write("[警告] 生成されたHTMLが見つかりませんでした。\n")
            return None
        src = candidates[0]
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        dest = RESULT_DIR / src.name
        shutil.copy2(src, dest)
        self._log_write(f"保存しました: {dest}\n")
        return dest

    def _copy_ai_outputs(
        self, player_id: str, p: dict, since: float
    ) -> Path | None:
        """②AI考察の素材と、自動作成できた場合のAI考察レポートHTMLを保存する。

        戻り値は開く対象となる②AIレポートHTML（無ければ None）。
        `since` はこの実行の開始時刻で、それ以降に生成されたHTMLだけを当該実行の
        結果として扱う（過去実行の古い②HTMLを誤って取り込まないため）。
        """
        RESULT_DIR.mkdir(parents=True, exist_ok=True)

        ai_report_src = self._expected_ai_report_path(player_id)
        ai_report_ready = (
            p["ai_report_method"] == "agent_cli"
            and ai_report_src is not None
            and ai_report_src.is_file()
            and ai_report_src.stat().st_mtime >= since
        )

        # AIチャット貼り付け手順の素材（JSON・プロンプト）を保存する。
        # AIエージェントCLIが失敗した場合も、同じ素材で手動手順へ切り替えられる。
        if p["ai_report_method"] == "manual_chat" or not ai_report_ready:
            summary_file = AI_QUALITY_SUMMARY.get(
                p["ai_quality"], "summary_standard.json"
            )
            material_files = [
                summary_file,
                "prompt_chat.md",
            ]
            saved_materials: list[Path] = []
            for name in material_files:
                src = AI_CACHE_DIR / name
                if not src.exists():
                    continue
                dest = RESULT_DIR / f"{player_id}_ai_{name}"
                shutil.copy2(src, dest)
                saved_materials.append(dest)
            if saved_materials:
                self._log_write(
                    "②AI素材を保存しました（外部AIチャットに渡せます）:\n"
                )
                for dest in saved_materials:
                    self._log_write(f"  {dest}\n")
                self._log_write(
                    "[次の手順] 上記のプロンプトとJSONをAIチャットに渡し、"
                    "AIチャット側で②AI考察レポートHTMLを作成してください。\n"
                )

        # ②AIレポートHTMLはAIエージェントCLIで自動作成した場合だけ取り込む。
        if p["ai_report_method"] != "agent_cli":
            return None

        src = ai_report_src
        if src is None or not ai_report_ready:
            self._log_write(
                "[注意] ②AI考察レポートHTMLはこの実行では生成されていません。"
                "CLI実行ログ（cache/ai/ai_agent_run.json）をご確認ください。"
                "保存済みの素材でAIチャット貼り付け手順へ切り替えられます。\n"
            )
            return None

        dest = RESULT_DIR / src.name
        shutil.copy2(src, dest)
        self._log_write(f"②AI考察レポートを保存しました: {dest}\n")
        return dest

    @staticmethod
    def _expected_ai_report_path(player_id: str) -> Path | None:
        """cache/report_data.json から、この入力に対応する②HTMLパスを決める。"""
        report_data = TEMPLATE_DIR / "cache" / "report_data.json"
        if not report_data.is_file():
            return None
        try:
            data = json.loads(report_data.read_text(encoding="utf-8"))
        except Exception:
            return None
        output_filename = data.get("output_filename")
        if not output_filename:
            return None
        expected_prefix = f"{player_id}_tetrio_performance_report_"
        if not str(output_filename).startswith(expected_prefix):
            return None
        stem = Path(output_filename).stem
        return TEMPLATE_OUTPUT_DIR / f"{stem}_ai_report.html"

    def _open_file(self, path: Path) -> None:
        try:
            os.startfile(path)  # type: ignore[attr-defined]
            self._log_write(f"ブラウザーで開きます: {path}\n")
        except Exception as exc:  # noqa: BLE001
            self._log_write(f"[警告] ファイルを開けませんでした: {exc}\n")

    # --------------------------------------------------------------- close
    def _on_close(self) -> None:
        self._save_config()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    ReportLauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
