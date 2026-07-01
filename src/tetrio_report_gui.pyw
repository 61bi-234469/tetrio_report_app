#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""TETR.IO 戦績レポート作成 GUI ランチャー.

GUIは薄いオーケストレーターとして、API取得・①戦績分析レポート・
②AI考察レポートの既存スクリプトを呼び出す。
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
import hashlib
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk


SRC_DIR = Path(__file__).resolve().parent
APP_ROOT = SRC_DIR.parent
EXPORT_SCRIPT = SRC_DIR / "api_export" / "tetrio_league_export.py"
EXPORT_OUTPUT_DIR = APP_ROOT / "data"
TEMPLATE_DIR = SRC_DIR / "report_builder"
MAKE_REPORT_PS1 = TEMPLATE_DIR / "make_report.ps1"
PREPARE_AI_MATERIALS = TEMPLATE_DIR / "scripts" / "prepare_ai_materials.py"
AI_CACHE_DIR = TEMPLATE_DIR / "cache" / "ai"
REQUIREMENTS = TEMPLATE_DIR / "requirements.txt"
VENV_DIR = TEMPLATE_DIR / ".venv"
VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
TEMPLATE_OUTPUT_DIR = TEMPLATE_DIR / "output"
RESULT_DIR = APP_ROOT / "reports"
CONFIG_PATH = APP_ROOT / "gui_config.json"
REQ_HASH_SENTINEL = TEMPLATE_DIR / "cache" / ".requirements.sha256"
LATEST_RUN_MANIFEST = TEMPLATE_DIR / "cache" / "latest_run_manifest.json"
PLACEHOLDER_USERNAME = "your_username"

AI_METHOD_CHOICES = [
    ("AIチャット用素材を保存", "manual_chat"),
    ("AIエージェントCLIで自動作成", "agent_cli"),
]
AI_REASONING_LEVEL_CHOICES = [
    ("標準", "standard"),
    ("高", "high"),
    ("低", "low"),
]
AI_AGENT_CHOICES = [
    ("Codex CLI", "codex"),
    ("Claude Code CLI", "claude"),
]
AI_REASONING_LEVEL_ALIASES = {
    "high_quality": "high",
    "low_cost": "low",
}
AI_INPUT_JSON = "ai_appendix_data.json"

DEFAULT_CONFIG = {
    "username": PLACEHOLDER_USERNAME,
    "max_matches": 100,
    "fetch_all": False,
    "api_save_csv": False,
    "api_save_base_files": False,
    "report_open_html": True,
    "report_show_opponent_names": False,
    "ai_open_html": True,
    "ai_report_method": "manual_chat",
    "ai_agent": "codex",
    "ai_reasoning_level": "standard",
}


def _label_to_value(choices: list[tuple[str, str]], label: str, fallback: str) -> str:
    for lab, val in choices:
        if lab == label:
            return val
    return fallback


def _value_to_label(choices: list[tuple[str, str]], value: str) -> str:
    value = AI_REASONING_LEVEL_ALIASES.get(value, value)
    for lab, val in choices:
        if val == value:
            return lab
    return choices[0][0]


class ReportLauncherApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("TETR.IO 戦績レポート作成")
        self.root.geometry("760x820")
        self.root.minsize(680, 720)

        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.worker: threading.Thread | None = None
        self.action_buttons: list[ttk.Button] = []

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
        common = ttk.LabelFrame(frm, text="共通設定", padding=8)
        common.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        common.columnconfigure(1, weight=1)

        ttk.Label(common, text="プレイヤーID").grid(row=0, column=0, sticky="w", **pad)
        self.username_var = tk.StringVar(value=cfg["username"])
        ttk.Entry(common, textvariable=self.username_var).grid(
            row=0, column=1, sticky="ew", **pad
        )

        ttk.Label(common, text="取得試合数").grid(row=1, column=0, sticky="w", **pad)
        count_frame = ttk.Frame(common)
        count_frame.grid(row=1, column=1, sticky="ew", **pad)
        self.max_matches_var = tk.IntVar(value=int(cfg["max_matches"]))
        self.spin = ttk.Spinbox(
            count_frame,
            from_=1,
            to=1_000_000,
            increment=50,
            textvariable=self.max_matches_var,
            width=12,
        )
        self.spin.pack(side="left")
        self.fetch_all_var = tk.BooleanVar(value=bool(cfg["fetch_all"]))
        ttk.Checkbutton(
            count_frame,
            text="取得できる全試合を対象にする",
            variable=self.fetch_all_var,
            command=self._toggle_all,
        ).pack(side="left", padx=12)
        self._toggle_all()

        row += 1
        api = ttk.LabelFrame(frm, text="⓪ 戦績データ取得 / API", padding=8)
        api.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.api_save_base_files_var = tk.BooleanVar(value=bool(cfg["api_save_base_files"]))
        self.api_save_csv_var = tk.BooleanVar(value=bool(cfg["api_save_csv"]))
        ttk.Checkbutton(
            api,
            text="派生指標を追加する前の元データも残す",
            variable=self.api_save_base_files_var,
        ).pack(anchor="w")
        ttk.Checkbutton(
            api,
            text="Parquetに加えてCSV形式でも保存する",
            variable=self.api_save_csv_var,
        ).pack(anchor="w")
        api_btns = ttk.Frame(api)
        api_btns.pack(fill="x", pady=(6, 0))
        self.api_run_btn = ttk.Button(
            api_btns, text="実行", command=lambda: self._start_worker("api")
        )
        self.api_run_btn.pack(side="left")
        self.api_open_btn = ttk.Button(
            api_btns, text="フォルダを開く", command=self._open_api_folder
        )
        self.api_open_btn.pack(side="left", padx=8)
        ttk.Label(
            api,
            text=(
                "API取得は公開TETRA CHANNEL APIを使います。"
                "短時間の連続取得を避けてください。"
            ),
            foreground="#555555",
            wraplength=680,
            justify="left",
        ).pack(anchor="w", pady=(8, 0))

        row += 1
        report = ttk.LabelFrame(frm, text="① 戦績分析レポート作成", padding=8)
        report.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.report_open_html_var = tk.BooleanVar(value=bool(cfg["report_open_html"]))
        self.report_show_opponent_names_var = tk.BooleanVar(
            value=bool(cfg["report_show_opponent_names"])
        )
        ttk.Label(
            report,
            text="使用データの参照とハッシュは cache/latest_run_manifest.json に記録します。",
            foreground="#555555",
            wraplength=680,
            justify="left",
        ).pack(anchor="w")
        ttk.Checkbutton(
            report,
            text="作成後にレポートをブラウザーで開く",
            variable=self.report_open_html_var,
        ).pack(anchor="w")
        ttk.Checkbutton(
            report,
            text="ライバル章で対戦相手の実名を表示（既定は匿名）",
            variable=self.report_show_opponent_names_var,
        ).pack(anchor="w")
        report_btns = ttk.Frame(report)
        report_btns.pack(fill="x", pady=(6, 0))
        self.report_run_btn = ttk.Button(
            report_btns, text="実行", command=lambda: self._start_worker("report")
        )
        self.report_run_btn.pack(side="left")
        self.report_open_btn = ttk.Button(
            report_btns, text="フォルダを開く", command=self._open_report_folder
        )
        self.report_open_btn.pack(side="left", padx=8)

        row += 1
        ai = ttk.LabelFrame(frm, text="② AI考察レポート作成（生成AIが必要）", padding=8)
        ai.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        ai.columnconfigure(1, weight=1)

        self.ai_open_html_var = tk.BooleanVar(value=bool(cfg["ai_open_html"]))
        ttk.Label(
            ai,
            text="AI素材は cache/ai に保存します。HTML生成時のみ reports に保存します。",
            foreground="#555555",
            wraplength=680,
            justify="left",
        ).grid(row=0, column=0, columnspan=2, sticky="w", **pad)
        self.ai_open_html_check = ttk.Checkbutton(
            ai,
            text="作成後にレポートをブラウザーで開く",
            variable=self.ai_open_html_var,
        )
        self.ai_open_html_check.grid(row=1, column=0, columnspan=2, sticky="w", **pad)

        ttk.Label(ai, text="作成方法").grid(row=2, column=0, sticky="w", **pad)
        self.ai_method_var = tk.StringVar(
            value=_value_to_label(AI_METHOD_CHOICES, cfg["ai_report_method"])
        )
        self.ai_method_combo = ttk.Combobox(
            ai,
            textvariable=self.ai_method_var,
            state="readonly",
            values=[lab for lab, _ in AI_METHOD_CHOICES],
        )
        self.ai_method_combo.grid(row=2, column=1, sticky="ew", **pad)
        self.ai_method_combo.bind(
            "<<ComboboxSelected>>", lambda _e: self._toggle_ai_agent()
        )

        ttk.Label(ai, text="推論レベル").grid(row=3, column=0, sticky="w", **pad)
        self.ai_reasoning_level_var = tk.StringVar(
            value=_value_to_label(AI_REASONING_LEVEL_CHOICES, cfg["ai_reasoning_level"])
        )
        self.ai_reasoning_level_combo = ttk.Combobox(
            ai,
            textvariable=self.ai_reasoning_level_var,
            state="readonly",
            values=[lab for lab, _ in AI_REASONING_LEVEL_CHOICES],
        )
        self.ai_reasoning_level_combo.grid(row=3, column=1, sticky="ew", **pad)

        ttk.Label(ai, text="連携AIエージェントCLI").grid(
            row=4, column=0, sticky="w", **pad
        )
        self.ai_agent_var = tk.StringVar(
            value=_value_to_label(AI_AGENT_CHOICES, cfg["ai_agent"])
        )
        self.ai_agent_combo = ttk.Combobox(
            ai,
            textvariable=self.ai_agent_var,
            state="readonly",
            values=[lab for lab, _ in AI_AGENT_CHOICES],
        )
        self.ai_agent_combo.grid(row=4, column=1, sticky="ew", **pad)
        self._toggle_ai_agent()

        ai_btns = ttk.Frame(ai)
        ai_btns.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(6, 0))
        self.ai_run_btn = ttk.Button(
            ai_btns, text="実行", command=lambda: self._start_worker("ai")
        )
        self.ai_run_btn.pack(side="left")
        self.ai_open_btn = ttk.Button(
            ai_btns, text="フォルダを開く", command=self._open_ai_folder
        )
        self.ai_open_btn.pack(side="left", padx=8)

        row += 1
        btns = ttk.Frame(frm)
        btns.grid(row=row, column=0, columnspan=2, sticky="ew", **pad)
        self.all_run_btn = ttk.Button(
            btns, text="まとめて実行", command=lambda: self._start_worker("all")
        )
        self.all_run_btn.pack(side="left")
        self.clear_btn = ttk.Button(btns, text="ログをクリア", command=self._clear_log)
        self.clear_btn.pack(side="left", padx=8)

        self.action_buttons = [
            self.api_run_btn,
            self.api_open_btn,
            self.report_run_btn,
            self.report_open_btn,
            self.ai_run_btn,
            self.ai_open_btn,
            self.all_run_btn,
            self.clear_btn,
        ]

        row += 1
        frm.rowconfigure(row, weight=1)
        self.log = scrolledtext.ScrolledText(
            frm,
            height=15,
            state="disabled",
            wrap="word",
            font=("Consolas", 9),
        )
        self.log.grid(row=row, column=0, columnspan=2, sticky="nsew", **pad)

    def _toggle_all(self) -> None:
        self.spin.configure(state="disabled" if self.fetch_all_var.get() else "normal")

    def _toggle_ai_agent(self) -> None:
        method = _label_to_value(AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat")
        self.ai_reasoning_level_combo.configure(
            state="readonly" if method == "agent_cli" else "disabled"
        )
        self.ai_agent_combo.configure(state="readonly" if method == "agent_cli" else "disabled")
        self.ai_open_html_check.configure(
            state="normal" if method == "agent_cli" else "disabled"
        )

    # ------------------------------------------------------------- config
    def _load_config(self) -> dict:
        cfg = dict(DEFAULT_CONFIG)
        if CONFIG_PATH.exists():
            try:
                loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    cfg.update(loaded)
            except Exception:
                pass

        cfg["api_save_csv"] = bool(cfg.get("api_save_csv", cfg.get("save_csv", False)))
        cfg["api_save_base_files"] = bool(
            cfg.get("api_save_base_files", cfg.get("save_base_files", False))
        )
        cfg["report_open_html"] = bool(
            cfg.get("report_open_html", cfg.get("open_report", True))
        )
        cfg["report_show_opponent_names"] = bool(cfg.get("report_show_opponent_names", False))
        cfg["ai_open_html"] = bool(
            cfg.get("ai_open_html", cfg.get("open_report", True))
        )
        reasoning_level = cfg.get("ai_reasoning_level", cfg.get("ai_quality", "standard"))
        reasoning_level = AI_REASONING_LEVEL_ALIASES.get(reasoning_level, reasoning_level)
        if reasoning_level not in {value for _, value in AI_REASONING_LEVEL_CHOICES}:
            reasoning_level = "standard"
        cfg["ai_reasoning_level"] = reasoning_level
        return cfg

    def _save_config(self) -> None:
        ai_method = _label_to_value(AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat")
        ai_agent = _label_to_value(AI_AGENT_CHOICES, self.ai_agent_var.get(), "codex")
        ai_reasoning_level = _label_to_value(
            AI_REASONING_LEVEL_CHOICES, self.ai_reasoning_level_var.get(), "standard"
        )
        cfg = {
            "username": self.username_var.get().strip().lower(),
            "max_matches": self._safe_int(self.max_matches_var, 100),
            "fetch_all": self.fetch_all_var.get(),
            "api_save_csv": self.api_save_csv_var.get(),
            "api_save_base_files": self.api_save_base_files_var.get(),
            "report_open_html": self.report_open_html_var.get(),
            "report_show_opponent_names": self.report_show_opponent_names_var.get(),
            "ai_open_html": self.ai_open_html_var.get(),
            "ai_report_method": ai_method,
            "ai_agent": ai_agent,
            "ai_reasoning_level": ai_reasoning_level,
            "save_csv": self.api_save_csv_var.get(),
            "save_base_files": self.api_save_base_files_var.get(),
            "open_report": self.report_open_html_var.get(),
        }
        try:
            CONFIG_PATH.write_text(
                json.dumps(cfg, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

    @staticmethod
    def _safe_int(var: tk.IntVar, fallback: int) -> int:
        try:
            return int(var.get())
        except Exception:
            return fallback

    def _collect_params(self) -> dict:
        ai_method = _label_to_value(
            AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat"
        )
        return {
            "username": self.username_var.get().strip().lower(),
            "fetch_all": self.fetch_all_var.get(),
            "max_matches": self._safe_int(self.max_matches_var, 100),
            "api_save_csv": self.api_save_csv_var.get(),
            "api_save_base_files": self.api_save_base_files_var.get(),
            "report_open_html": self.report_open_html_var.get(),
            "report_show_opponent_names": self.report_show_opponent_names_var.get(),
            "ai_open_html": self.ai_open_html_var.get() and ai_method == "agent_cli",
            "ai_report_method": ai_method,
            "ai_agent": _label_to_value(AI_AGENT_CHOICES, self.ai_agent_var.get(), "codex"),
            "ai_reasoning_level": _label_to_value(
                AI_REASONING_LEVEL_CHOICES, self.ai_reasoning_level_var.get(), "standard"
            ),
        }

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
    def _start_worker(self, mode: str) -> None:
        if self.worker and self.worker.is_alive():
            return
        username = self.username_var.get().strip().lower()
        if not username or username == PLACEHOLDER_USERNAME:
            messagebox.showwarning("入力エラー", "プレイヤーIDを入力してください。")
            return

        self.username_var.set(username)
        self._save_config()
        self._set_actions_state("disabled")

        params = self._collect_params()
        self.worker = threading.Thread(
            target=self._run_pipeline,
            args=(mode, params),
            daemon=True,
        )
        self.worker.start()

    def _set_actions_state(self, state: str) -> None:
        for button in self.action_buttons:
            button.configure(state=state)

    def _finish(self) -> None:
        self._set_actions_state("normal")
        self._toggle_ai_agent()

    # ----------------------------------------------------- subprocess util
    def _stream(self, cmd: list[str], cwd: Path) -> int:
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        self._log_write(f"\n$ {' '.join(cmd)}\n")
        # Windowsでは子プロセス(python/PowerShell)起動時に空のコンソール
        # ウィンドウが開くため、CREATE_NO_WINDOWで抑制する。
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
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
                creationflags=creationflags,
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
    def _run_pipeline(self, mode: str, p: dict) -> None:
        context = self._new_context(p["username"])
        try:
            python_exe = self._python_exe()
            if mode in {"api", "all"}:
                if not self._run_api_step(p, python_exe, context):
                    return
            if mode in {"report", "all"}:
                if not self._run_report_step(p, context):
                    return
            if mode == "ai":
                if not self._run_ai_report_step(p, python_exe, context, reuse_report_cache=False):
                    return
            elif mode == "all":
                if not self._run_ai_report_step(p, python_exe, context, reuse_report_cache=True):
                    return

            self._write_run_manifest(p, context)
            self._log_write("\n完了しました。\n")
        except Exception as exc:  # noqa: BLE001
            self._log_write(f"\n[例外] {exc}\n")
        finally:
            self.root.after(0, self._finish)

    def _new_context(self, player_id: str) -> dict:
        rounds_pq, matches_pq = self._report_input_paths(player_id)
        return {
            "player_id": player_id,
            "rounds_pq": rounds_pq,
            "matches_pq": matches_pq,
            "created_at": datetime.now().astimezone(),
            "saved_report": None,
            "saved_ai_report": None,
            "saved_ai_materials": [],
            "report_ran": False,
            "ai_ran": False,
        }

    def _run_api_step(self, p: dict, python_exe: str, context: dict) -> bool:
        self._log_write("\n========== ⓪ 戦績データ取得 / API ==========\n")
        EXPORT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        cmd = [
            python_exe,
            str(EXPORT_SCRIPT),
            "--source",
            "api",
            "--username",
            p["username"],
            "--outputs",
            "all" if p["api_save_csv"] else "parquet",
            "--output-dir",
            str(EXPORT_OUTPUT_DIR),
            "--output-layout",
            "typed",
        ]
        if not p["api_save_base_files"]:
            cmd.append("--no-base-outputs")
        if p["fetch_all"]:
            cmd.append("--all")
        else:
            cmd += ["--max-matches", str(max(1, p["max_matches"]))]

        rc = self._stream(cmd, cwd=EXPORT_OUTPUT_DIR)
        if rc != 0:
            self._log_write("\n[中断] API取得でエラーが発生しました。\n")
            return False
        context["rounds_pq"], context["matches_pq"] = self._report_input_paths(p["username"])
        return True

    def _run_report_step(self, p: dict, context: dict) -> bool:
        self._log_write("\n========== ① 戦績分析レポート作成 ==========\n")
        if not self._ensure_report_inputs(context):
            return False

        run_started = time.time()
        ps_inner = (
            "$OutputEncoding=[Console]::OutputEncoding="
            "[System.Text.Encoding]::UTF8; "
            f"& '{MAKE_REPORT_PS1}' "
            f"-DataFile '{context['rounds_pq']}' "
            f"-MatchesFile '{context['matches_pq']}' "
            f"-Player '{p['username']}' "
            "-Force"
        )
        if p.get("report_show_opponent_names"):
            ps_inner += " -ShowOpponentNames"
        cmd = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            ps_inner,
        ]
        rc = self._stream(cmd, cwd=TEMPLATE_DIR)
        if rc != 0:
            self._log_write("\n[中断] ①レポート作成でエラーが発生しました。\n")
            return False

        context["saved_report"] = self._copy_latest_report(
            p["username"],
            context["created_at"],
            since=run_started,
        )
        context["report_ran"] = True

        if p["report_open_html"] and context["saved_report"] is not None:
            self._open_file(context["saved_report"])
        return True

    def _run_ai_report_step(
        self,
        p: dict,
        python_exe: str,
        context: dict,
        *,
        reuse_report_cache: bool,
    ) -> bool:
        self._log_write("\n========== ② AI考察レポート作成（生成AIが必要） ==========\n")
        if not self._ensure_report_inputs(context):
            return False

        if reuse_report_cache:
            if not self._prepare_ai_from_existing_cache(p, python_exe):
                return False
        else:
            if not self._run_ai_materials_step(p, python_exe, context):
                return False

        agent_attempted = p["ai_report_method"] == "agent_cli"
        agent_pipeline_ok = False
        run_started = time.time()
        if agent_attempted:
            agent_pipeline_ok = self._run_ai_agent_pipeline(p, python_exe)

        saved_ai_report, saved_ai_materials = self._copy_ai_outputs(
            p["username"],
            p,
            since=run_started,
            created_at=context["created_at"],
        )
        context["saved_ai_report"] = saved_ai_report
        context["saved_ai_materials"].extend(saved_ai_materials)

        context["ai_ran"] = True

        if agent_attempted and not agent_pipeline_ok:
            self._log_write(
                "[注意] ②HTMLの自動作成は完了していません。保存済み素材を利用できます。\n"
            )

        if p["ai_open_html"]:
            if saved_ai_report is not None:
                self._open_file(saved_ai_report)
            else:
                if AI_CACHE_DIR.exists():
                    self._open_file(AI_CACHE_DIR)
        return True

    def _run_ai_materials_step(self, p: dict, python_exe: str, context: dict) -> bool:
        cmd = [
            python_exe,
            str(PREPARE_AI_MATERIALS),
            str(context["rounds_pq"]),
            "--matches",
            str(context["matches_pq"]),
            "--player",
            p["username"],
            "--reasoning-level",
            p["ai_reasoning_level"],
        ]
        rc = self._stream(cmd, cwd=TEMPLATE_DIR)
        if rc != 0:
            self._log_write("\n[中断] AI素材準備でエラーが発生しました。\n")
            return False
        return True

    def _prepare_ai_from_existing_cache(self, p: dict, python_exe: str) -> bool:
        required = [
            TEMPLATE_DIR / "cache" / "ai_analysis_payload.json",
            TEMPLATE_DIR / "cache" / "chapter_index.json",
            TEMPLATE_DIR / "cache" / "report_data.json",
        ]
        missing = [str(path) for path in required if not path.is_file()]
        if missing:
            self._log_write("[中断] ①レポートのキャッシュが見つかりません:\n")
            for path in missing:
                self._log_write(f"  {path}\n")
            return False

        steps = [
            [
                python_exe,
                str(TEMPLATE_DIR / "scripts" / "prepare_ai_summary.py"),
                "--reasoning-level",
                p["ai_reasoning_level"],
            ],
            [
                python_exe,
                str(TEMPLATE_DIR / "scripts" / "build_ai_prompt.py"),
                "--reasoning-level",
                p["ai_reasoning_level"],
            ],
        ]
        for cmd in steps:
            rc = self._stream(cmd, cwd=TEMPLATE_DIR)
            if rc != 0:
                self._log_write("\n[中断] AI素材準備でエラーが発生しました。\n")
                return False
        return True

    def _run_ai_agent_pipeline(self, p: dict, python_exe: str) -> bool:
        steps = [
            [
                python_exe,
                str(TEMPLATE_DIR / "scripts" / "run_ai_agent_cli.py"),
                "--agent",
                p["ai_agent"],
                "--reasoning-level",
                p["ai_reasoning_level"],
            ],
            [python_exe, str(TEMPLATE_DIR / "scripts" / "validate_ai_text.py")],
            [python_exe, str(TEMPLATE_DIR / "scripts" / "render_ai_text_to_html.py")],
        ]
        for cmd in steps:
            rc = self._stream(cmd, cwd=TEMPLATE_DIR)
            if rc != 0:
                return False
        return True

    def _ensure_report_inputs(self, context: dict) -> bool:
        rounds_pq = context["rounds_pq"]
        matches_pq = context["matches_pq"]
        if not rounds_pq.is_file():
            self._log_write(
                f"\n[中断] 入力データが見つかりません: {rounds_pq}\n"
                "先に「⓪ 戦績データ取得 / API」を実行してください。\n"
            )
            return False
        if not matches_pq.is_file():
            self._log_write(
                f"\n[中断] 試合データが見つかりません: {matches_pq}\n"
                "先に「⓪ 戦績データ取得 / API」を実行してください。\n"
            )
            return False
        return True

    @staticmethod
    def _report_input_paths(player_id: str) -> tuple[Path, Path]:
        typed_rounds = (
            EXPORT_OUTPUT_DIR
            / "parquet"
            / f"{player_id}_tetra_league_rounds_with_params.parquet"
        )
        typed_matches = (
            EXPORT_OUTPUT_DIR
            / "parquet"
            / f"{player_id}_tetra_league_matches_with_params.parquet"
        )
        if typed_rounds.exists() and typed_matches.exists():
            return typed_rounds, typed_matches

        grouped_rounds = (
            EXPORT_OUTPUT_DIR
            / player_id
            / "parquet"
            / f"{player_id}_tetra_league_rounds_with_params.parquet"
        )
        grouped_matches = (
            EXPORT_OUTPUT_DIR
            / player_id
            / "parquet"
            / f"{player_id}_tetra_league_matches_with_params.parquet"
        )
        if grouped_rounds.exists() and grouped_matches.exists():
            return grouped_rounds, grouped_matches

        return (
            EXPORT_OUTPUT_DIR / f"{player_id}_tetra_league_rounds_with_params.parquet",
            EXPORT_OUTPUT_DIR / f"{player_id}_tetra_league_matches_with_params.parquet",
        )

    def _copy_latest_report(
        self,
        player_id: str,
        created_at: datetime,
        *,
        since: float | None = None,
    ) -> Path | None:
        if not TEMPLATE_OUTPUT_DIR.exists():
            self._log_write("[警告] output フォルダーが見つかりません。\n")
            return None
        threshold = None if since is None else since - 2.0
        patterns = [
            f"{player_id}_tetrio_performance_report_*.html",
            f"*_{player_id}_tetrio_performance_report.html",
            "*.html",
        ]
        candidates: list[Path] = []
        for pattern in patterns:
            candidates = self._latest_html_candidates(
                TEMPLATE_OUTPUT_DIR.glob(pattern),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
                threshold=threshold,
            )
            if candidates:
                break
        if not candidates:
            self._log_write("[警告] 生成されたHTMLが見つかりませんでした。\n")
            return None

        src = candidates[0]
        dest = self._unique_report_path(player_id, "report", created_at)
        shutil.copy2(src, dest)
        self._log_write(f"①レポートを保存しました: {dest}\n")
        return dest

    @staticmethod
    def _unique_report_path(player_id: str, kind: str, created_at: datetime) -> Path:
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = created_at.strftime("%Y_%m_%d_%H%M")
        base = RESULT_DIR / f"{player_id}_{kind}_{stamp}.html"
        if not base.exists():
            return base
        suffix = 2
        while True:
            candidate = RESULT_DIR / f"{player_id}_{kind}_{stamp}_{suffix}.html"
            if not candidate.exists():
                return candidate
            suffix += 1

    @staticmethod
    def _latest_html_candidates(paths, *, key, reverse: bool, threshold: float | None) -> list[Path]:
        result = []
        for path in paths:
            if path.name.endswith("_ai_report.html"):
                continue
            if threshold is not None and path.stat().st_mtime < threshold:
                continue
            result.append(path)
        return sorted(result, key=key, reverse=reverse)

    def _copy_ai_outputs(
        self,
        player_id: str,
        p: dict,
        since: float,
        created_at: datetime,
    ) -> tuple[Path | None, list[Path]]:
        ai_report_src = self._expected_ai_report_path(player_id)
        ai_report_ready = (
            p["ai_report_method"] == "agent_cli"
            and ai_report_src is not None
            and ai_report_src.is_file()
            and ai_report_src.stat().st_mtime >= since - 2.0
        )

        saved_materials: list[Path] = []
        if p["ai_report_method"] == "manual_chat" or not ai_report_ready:
            material_files = [
                AI_INPUT_JSON,
                "prompt_chat.md",
                "prompt_codex.md",
                "prompt_claude.md",
                "report_text_schema.json",
            ]
            for name in material_files:
                src = AI_CACHE_DIR / name
                if not src.exists():
                    continue
                saved_materials.append(src)
            if saved_materials:
                self._log_write("②AI素材を cache に保存しました:\n")
                for dest in saved_materials:
                    self._log_write(f"  {dest}\n")

        if p["ai_report_method"] != "agent_cli":
            return None, saved_materials

        if not ai_report_ready or ai_report_src is None:
            self._log_write(
                "[注意] ②AI考察レポートHTMLはこの実行では生成されていません。\n"
            )
            return None, saved_materials

        dest = self._unique_report_path(player_id, "ai_report", created_at)
        shutil.copy2(ai_report_src, dest)
        self._log_write(f"②AI考察レポートを保存しました: {dest}\n")
        return dest, saved_materials

    def _write_run_manifest(self, p: dict, context: dict) -> None:
        saved_ai_materials = self._unique_paths(context["saved_ai_materials"])
        source_data = self._source_data_manifest(
            [context["rounds_pq"], context["matches_pq"]]
        )
        manifest = {
            "schema_version": 1,
            "created_at": context["created_at"].isoformat(timespec="seconds"),
            "player": p["username"],
            "report_html": str(context["saved_report"]) if context["saved_report"] else None,
            "ai_report_html": (
                str(context["saved_ai_report"]) if context["saved_ai_report"] else None
            ),
            "source_data": source_data,
            "ai_materials": [str(path) for path in saved_ai_materials],
            "settings": {
                "max_matches": p["max_matches"],
                "fetch_all": bool(p["fetch_all"]),
                "api_save_csv": bool(p["api_save_csv"]),
                "api_save_base_files": bool(p["api_save_base_files"]),
            },
            "report": {
                "ran": bool(context["report_ran"]),
                "open_html": bool(p["report_open_html"]),
            },
            "ai": {
                "ran": bool(context["ai_ran"]),
                "method": p["ai_report_method"] if context["ai_ran"] else None,
                "reasoning_level": p["ai_reasoning_level"] if context["ai_ran"] else None,
                "agent": (
                    p["ai_agent"]
                    if context["ai_ran"] and p["ai_report_method"] == "agent_cli"
                    else None
                ),
                "open_html": bool(p["ai_open_html"]),
                "agent_report_ready": context["saved_ai_report"] is not None,
            },
        }
        LATEST_RUN_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        LATEST_RUN_MANIFEST.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._log_write(f"実行情報を保存しました: {LATEST_RUN_MANIFEST}\n")

    @staticmethod
    def _source_data_manifest(paths: list[Path]) -> list[dict[str, object]]:
        entries: list[dict[str, object]] = []
        seen: set[str] = set()
        for path in paths:
            if not path.is_file():
                continue
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            entries.append(
                {
                    "path": key,
                    "sha256": ReportLauncherApp._sha256_file(path),
                    "bytes": path.stat().st_size,
                }
            )
        return entries

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _unique_paths(paths: list[Path]) -> list[Path]:
        seen: set[str] = set()
        result: list[Path] = []
        for path in paths:
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            result.append(path)
        return result

    @staticmethod
    def _expected_ai_report_path(player_id: str) -> Path | None:
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

    # ---------------------------------------------------------- open paths
    def _open_api_folder(self) -> None:
        EXPORT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        self._open_file(EXPORT_OUTPUT_DIR)

    def _open_report_folder(self) -> None:
        RESULT_DIR.mkdir(parents=True, exist_ok=True)
        self._open_file(RESULT_DIR)

    def _open_ai_folder(self) -> None:
        method = _label_to_value(AI_METHOD_CHOICES, self.ai_method_var.get(), "manual_chat")
        target = AI_CACHE_DIR if method == "manual_chat" else RESULT_DIR
        target.mkdir(parents=True, exist_ok=True)
        self._open_file(target)

    def _open_file(self, path: Path) -> None:
        try:
            os.startfile(path)  # type: ignore[attr-defined]
            self._log_write(f"開きます: {path}\n")
        except Exception as exc:  # noqa: BLE001
            self._log_write(f"[警告] 開けませんでした: {path} ({exc})\n")

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
