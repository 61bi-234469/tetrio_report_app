#!/usr/bin/env python3
"""Run Codex CLI / Claude Code CLI non-interactively for the AI report.

The GUI and make_report.ps1 call this wrapper so CLI discovery, execution,
failure logging, partial output capture, timeout handling, sandbox options,
and authentication hints stay in one place.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import shutil
import subprocess
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "ai_agent_cli.json"
AI_CACHE = PROJECT_ROOT / "cache" / "ai"

AGENT_PROMPT = {"codex": "prompt_codex.md", "claude": "prompt_claude.md"}
REGULAR_REPORT_SECTIONS = (
    "overview",
    "growth_stability",
    "capability",
    "win_factors",
    "style_matchup",
    "opponent_expectation",
    "rivals",
    "clutch",
    "comeback",
    "round_time",
    "session_flow",
)
REPORT_TEXT_FIELDS = (
    "_meta",
    *REGULAR_REPORT_SECTIONS,
    "summary",
    "method",
    "evidence",
)


def load_config() -> dict:
    if not CONFIG_PATH.is_file():
        raise SystemExit(f"設定ファイルが見つかりません: {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def resolve_executable(spec: dict) -> str | None:
    path = shutil.which(spec["executable"])
    if path is None:
        return None
    if os.name == "nt" and spec["executable"].lower() == "claude":
        exe_path = Path(path)
        if exe_path.suffix.lower() in {".cmd", ".bat", ".ps1", ""}:
            direct = exe_path.parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
            if direct.is_file():
                return str(direct)
    return path


def check_auth(spec: dict) -> bool:
    """Return True when one configured auth-related environment variable exists."""
    return any(os.environ.get(name) for name in spec.get("auth_env", []))


def configured_model_arg(spec: dict) -> str | None:
    args = [str(item) for item in spec.get("base_args", [])]
    for index, arg in enumerate(args):
        if arg in {"--model", "-m"} and index + 1 < len(args):
            return args[index + 1].strip() or None
        for prefix in ("--model=", "-m="):
            if arg.startswith(prefix):
                return arg[len(prefix) :].strip() or None
    return None


def _format_version_tokens(tokens: list[str]) -> str:
    result: list[str] = []
    number_run: list[str] = []
    for token in tokens:
        if token.isdigit():
            number_run.append(token)
            continue
        if number_run:
            result.append(".".join(number_run))
            number_run = []
        result.append(token.title())
    if number_run:
        result.append(".".join(number_run))
    return " ".join(result)


def format_claude_model(raw_model: str) -> str:
    raw_model = raw_model.strip()
    if raw_model.lower().startswith("claude "):
        return raw_model

    normalized = raw_model.lower().replace("_", "-")
    if normalized.startswith("claude-"):
        normalized = normalized.removeprefix("claude-")
    normalized = normalized.removesuffix("-latest")
    tokens = [token for token in re.split(r"[-\s]+", normalized) if token]
    families = {"opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku"}

    if tokens and tokens[0] in families:
        family = families[tokens[0]]
        rest = _format_version_tokens(tokens[1:])
        return f"Claude {family}{(' ' + rest) if rest else ''}"

    for index, token in enumerate(tokens):
        if token not in families:
            continue
        family = families[token]
        before = _format_version_tokens(tokens[:index])
        after = _format_version_tokens(tokens[index + 1 :])
        version = " ".join(part for part in (before, after) if part)
        return f"Claude {family}{(' ' + version) if version else ''}"

    label = raw_model.replace("_", " ").replace("-", " ").strip()
    return f"Claude {label}" if label else "Claude"


def format_codex_model(raw_model: str) -> str:
    label = raw_model.strip().replace("_", "-")
    parts = [part for part in re.split(r"[-\s]+", label) if part]
    if not parts:
        return label
    display_parts = []
    index = 0
    while index < len(parts):
        part = parts[index]
        lower = part.lower()
        if lower == "gpt" and index + 1 < len(parts):
            display_parts.append(f"GPT-{parts[index + 1]}")
            index += 2
            continue
        if lower == "gpt":
            display_parts.append("GPT")
        elif lower == "codex":
            display_parts.append("Codex")
        else:
            display_parts.append(part.upper() if part.replace(".", "").isdigit() else part.title())
        index += 1
    return " ".join(display_parts)


def ai_model_display_name(agent: str, spec: dict) -> str | None:
    configured = str(spec.get("model_display_name", "")).strip()
    if configured:
        return configured

    raw_model = configured_model_arg(spec)
    if raw_model is None:
        return None
    if agent == "claude":
        return format_claude_model(raw_model)
    if agent == "codex":
        return format_codex_model(raw_model)
    return raw_model


def keep_fields(value: object, allowed: tuple[str, ...]) -> object:
    if not isinstance(value, dict):
        return value
    return {key: value[key] for key in allowed if key in value}


def normalize_report_text(data: dict) -> dict:
    """Drop harmless extra keys before strict schema validation runs."""
    normalized = keep_fields(data, REPORT_TEXT_FIELDS)
    if not isinstance(normalized, dict):
        return data

    if "_meta" in normalized:
        normalized["_meta"] = keep_fields(
            normalized.get("_meta"),
            ("ai_model", "player_name", "source_period", "generated_date"),
        )
    for section in REGULAR_REPORT_SECTIONS:
        if section in normalized:
            normalized[section] = keep_fields(
                normalized.get(section), ("key", "bullets", "summary")
            )

    if "summary" in normalized:
        normalized["summary"] = keep_fields(normalized.get("summary"), ("key", "body"))
    if "method" in normalized:
        normalized["method"] = keep_fields(normalized.get("method"), ("key", "bullets"))
    if "evidence" in normalized:
        normalized["evidence"] = keep_fields(normalized.get("evidence"), ("body",))
    return normalized


def fill_ai_model_meta(extracted: str, agent: str, spec: dict) -> tuple[str, str | None]:
    data = json.loads(extracted)
    if not isinstance(data, dict):
        return extracted, None
    data = normalize_report_text(data)

    meta = data.get("_meta")
    if not isinstance(meta, dict):
        meta = {}

    current = str(meta.get("ai_model", "")).strip()
    if current and current not in {"-", "AIエージェントCLI"}:
        return json.dumps(data, ensure_ascii=False, indent=2), current

    display_name = ai_model_display_name(agent, spec)
    if display_name:
        meta["ai_model"] = display_name
        data["_meta"] = meta
        return json.dumps(data, ensure_ascii=False, indent=2), display_name
    return json.dumps(data, ensure_ascii=False, indent=2), None


def do_check(agent: str, spec: dict) -> int:
    path = resolve_executable(spec)
    info: dict[str, object] = {
        "agent": agent,
        "display_name": spec.get("display_name", agent),
        "model_display_name": ai_model_display_name(agent, spec),
        "executable": spec["executable"],
        "found": path is not None,
        "path": path,
        "auth_env_set": check_auth(spec),
        "timeout_seconds": spec.get("timeout_seconds"),
        "network": spec.get("network"),
    }

    if path is not None:
        try:
            proc = subprocess.run(
                [path, *spec.get("version_args", ["--version"])],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
            )
            info["version"] = (proc.stdout or proc.stderr or "").strip()
            info["version_exit_code"] = proc.returncode
        except (subprocess.TimeoutExpired, OSError) as exc:
            info["version_error"] = str(exc)

    print(json.dumps(info, ensure_ascii=False, indent=2))
    if path is None:
        print(
            f"\n{spec.get('display_name', agent)} が見つかりません。"
            f"実行ファイル `{spec['executable']}` をPATHに通してください。"
        )
        return 1
    if not info["auth_env_set"]:
        print(
            "\n[注意] 認証用の環境変数は見つかりませんでした。"
            "CLI側でログイン済みなら実行できる場合があります。"
        )
    return 0


def extract_json(raw: str) -> str | None:
    """Extract the body JSON from CLI output."""
    text = raw.strip()
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        pass

    fence = "```"
    if fence in text:
        segments = text.split(fence)
        for seg in segments:
            candidate = seg
            if candidate.lstrip().lower().startswith("json"):
                candidate = candidate.lstrip()[4:]
            candidate = candidate.strip()
            if candidate.startswith("{"):
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    continue

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        try:
            json.loads(candidate)
            return candidate
        except json.JSONDecodeError:
            return None
    return None


def build_command(path: str, spec: dict, prompt_text: str) -> list[str]:
    cmd = [path, *spec.get("base_args", [])]
    if spec.get("network") is False:
        cmd += spec.get("sandbox_args", [])
    if spec.get("prompt_via", "argument") == "argument":
        cmd.append(prompt_text)
    return cmd


def prompt_stdin(spec: dict, prompt_text: str) -> str | None:
    if spec.get("prompt_via", "argument") == "stdin":
        return prompt_text
    return None


def effective_prompt_spec(spec: dict, prompt_text: str) -> dict:
    """Avoid Windows CreateProcess limits when a long prompt is configured as argv."""
    # Bundled agent settings currently use stdin. This stays as a guard for
    # local or legacy configs that switch prompt delivery back to argv.
    if os.name != "nt" or spec.get("prompt_via", "argument") != "argument":
        return spec
    if len(prompt_text) <= 8000:
        return spec

    effective = dict(spec)
    effective["prompt_via"] = "stdin"
    print(
        "長いプロンプトのため、AIエージェントCLIへ標準入力で渡します。",
        flush=True,
    )
    return effective


def redact_command(cmd: list[str], spec: dict) -> list[str]:
    if spec.get("prompt_via", "argument") == "argument":
        return cmd[:-1] + ["<prompt>"] if cmd else cmd
    return [*cmd, "<prompt via stdin>"]


def terminate_process_tree(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            text=True,
        )
    else:
        proc.kill()


def run_cli_command(
    cmd: list[str],
    prompt_input: str | None,
    timeout: int,
) -> tuple[str, str, int | None, bool]:
    proc = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdin=subprocess.PIPE if prompt_input is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(f"AIエージェントCLIを実行中です。最大 {timeout} 秒待ちます。", flush=True)

    deadline = time.monotonic() + timeout
    next_notice = time.monotonic() + 30
    input_for_call = prompt_input
    while True:
        remaining = max(0.1, deadline - time.monotonic())
        wait_for = min(5.0, remaining)
        try:
            stdout, stderr = proc.communicate(input=input_for_call, timeout=wait_for)
            return stdout or "", stderr or "", proc.returncode, False
        except subprocess.TimeoutExpired:
            input_for_call = None
            now = time.monotonic()
            if now >= deadline:
                terminate_process_tree(proc)
                stdout, stderr = proc.communicate()
                return stdout or "", stderr or "", proc.returncode, True
            if now >= next_notice:
                elapsed = int(timeout - (deadline - now))
                print(f"AIエージェントCLIの応答待ちです... {elapsed}秒経過", flush=True)
                next_notice = now + 30


def classify_failure(agent: str, spec: dict, stdout: str, stderr: str) -> str | None:
    combined = f"{stdout}\n{stderr}".lower()
    if any(
        needle in combined
        for needle in (
            "failed to authenticate",
            "invalid authentication credentials",
            "unauthorized",
            "401",
            "api key",
            "oauth",
        )
    ):
        env_names = ", ".join(spec.get("auth_env", []))
        if agent == "claude":
            return (
                f"{spec.get('display_name', agent)} の非対話実行（claude -p）で認証に失敗しました。"
                " `claude auth status` が loggedIn=true でも、保存済みトークンが失効している場合があります。"
                " `src\\report_builder\\repair_claude_cli_auth.bat` を実行して、CLIログインを更新してください。"
                " 手動で行う場合は、cmdで `claude auth logout`、`claude auth login --claudeai`、"
                " `claude -p \"Say OK only\"` の順に実行します。"
                " まだ失敗する場合は `claude setup-token` で長期トークンを作成してください。"
            )
        return (
            f"{spec.get('display_name', agent)} の認証に失敗しました。"
            f"CLIでログインし直すか、認証用環境変数を設定してください: {env_names}"
        )
    if "rate limit" in combined or "429" in combined:
        return "AIエージェントCLIがレート制限に達しました。時間を置いて再実行してください。"
    if "network" in combined or "connection" in combined or "timeout" in combined:
        return "AIエージェントCLIのネットワーク接続またはタイムアウトで失敗しました。"
    return None


def tail(text: str, limit: int = 2000) -> str:
    return text[-limit:] if text else ""


def read_auth_status(path: str, agent: str, timeout: int = 10) -> dict | None:
    if agent != "claude":
        return None
    try:
        proc = subprocess.run(
            [path, "auth", "status", "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        status = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    return {
        "loggedIn": status.get("loggedIn"),
        "authMethod": status.get("authMethod"),
        "apiProvider": status.get("apiProvider"),
        "subscriptionType": status.get("subscriptionType"),
    }


def normalize_reasoning_level(value: str) -> str:
    return {
        "high_quality": "high",
        "low_cost": "low",
    }.get(value, value)


def do_run(agent: str, spec: dict, reasoning_level: str) -> int:
    reasoning_level = normalize_reasoning_level(reasoning_level)
    path = resolve_executable(spec)
    AI_CACHE.mkdir(parents=True, exist_ok=True)
    run_log = AI_CACHE / "ai_agent_run.json"

    prompt_file = AI_CACHE / AGENT_PROMPT[agent]
    if not prompt_file.is_file():
        raise SystemExit(
            f"プロンプトが見つかりません: {prompt_file}\n"
            "先に build_ai_prompt.py を実行してください。"
        )

    log: dict[str, object] = {
        "agent": agent,
        "reasoning_level": reasoning_level,
        "prompt_file": str(prompt_file),
        "found": path is not None,
        "model_display_name": ai_model_display_name(agent, spec),
    }

    if path is None:
        log["error"] = f"{spec['executable']} が見つかりません。"
        run_log.write_text(
            json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(log["error"])
        return 1

    prompt_text = prompt_file.read_text(encoding="utf-8")
    run_spec = effective_prompt_spec(spec, prompt_text)
    cmd = build_command(path, run_spec, prompt_text)
    timeout = spec.get("timeout_seconds", 600)

    raw_path = AI_CACHE / "report_text.raw.txt"
    json_path = AI_CACHE / "report_text.json"

    start = time.monotonic()
    stdout = ""
    stderr = ""
    exit_code: int | None = None
    timed_out = False
    try:
        stdout, stderr, exit_code, timed_out = run_cli_command(
            cmd,
            prompt_stdin(run_spec, prompt_text),
            timeout,
        )
    except KeyboardInterrupt:
        print("[中断] AIエージェントCLIの実行を中断しました。", file=sys.stderr)
        raise
    duration = round(time.monotonic() - start, 2)

    raw_path.write_text(stdout, encoding="utf-8")

    extracted = extract_json(stdout) if stdout else None
    rendered_model_name = None
    if extracted is not None:
        report_text, rendered_model_name = fill_ai_model_meta(extracted, agent, spec)
        json_path.write_text(report_text, encoding="utf-8")

    error_hint = classify_failure(agent, spec, stdout, stderr)
    auth_status = read_auth_status(path, agent)
    log.update(
        {
            "command": redact_command(cmd, run_spec),
            "prompt_via": run_spec.get("prompt_via", "argument"),
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_seconds": duration,
            "stdout_tail": tail(stdout),
            "stderr_tail": tail(stderr),
            "auth_status": auth_status,
            "error_hint": error_hint,
            "raw_output_path": str(raw_path),
            "json_extracted": extracted is not None,
            "json_path": str(json_path) if extracted is not None else None,
            "rendered_model_name": rendered_model_name,
            "partial_output": (exit_code not in (0, None)) or timed_out,
        }
    )
    run_log.write_text(
        json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if timed_out:
        print(
            f"[失敗] タイムアウトしました（{timeout}秒）。"
            f"部分出力を保存しました: {raw_path}"
        )
        if error_hint:
            print(f"原因候補: {error_hint}")
        return 1
    if exit_code != 0:
        print(
            f"[失敗] AIエージェントCLIが exit code {exit_code} で終了しました。"
            f"出力を保存しました: {raw_path}"
        )
        if error_hint:
            print(f"原因候補: {error_hint}")
        return exit_code or 1
    if extracted is None:
        print(
            "[失敗] AIエージェントCLIの出力から本文JSONを抽出できませんでした。"
            f"出力を確認してください: {raw_path}"
        )
        return 1

    print(f"OK: 本文JSONを保存しました: {json_path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", choices=["codex", "claude"], required=True)
    parser.add_argument("--check", action="store_true", help="実行可否と前提を確認する")
    parser.add_argument(
        "--reasoning-level",
        choices=["standard", "high", "low"],
        default="standard",
    )
    parser.add_argument(
        "--quality",
        dest="reasoning_level",
        choices=["standard", "high", "low", "high_quality", "low_cost"],
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    config = load_config()
    spec = config.get(args.agent)
    if spec is None:
        raise SystemExit(f"未知のエージェントです: {args.agent}")

    if args.check:
        raise SystemExit(do_check(args.agent, spec))
    raise SystemExit(do_run(args.agent, spec, args.reasoning_level))


if __name__ == "__main__":
    main()
