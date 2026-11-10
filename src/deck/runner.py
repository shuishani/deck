import json
import subprocess
from collections.abc import Callable, Sequence

Runner = Callable[[Sequence[str]], dict]


class ToolError(Exception):
    """外部 CLI 调用失败，或返回了错误结果。"""


def run_json(argv: Sequence[str], timeout: int = 120) -> dict:
    try:
        proc = subprocess.run(
            list(argv), capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as error:
        raise ToolError(f"找不到命令 {argv[0]}，检查 config.toml 的 [tools]") from error
    except subprocess.TimeoutExpired as error:
        raise ToolError(f"{argv[0]} 超过 {timeout} 秒没有返回") from error
    out = proc.stdout.strip()
    try:
        data = json.loads(out) if out else {}
    except json.JSONDecodeError as error:
        detail = out[:200] or proc.stderr.strip()[:200]
        raise ToolError(f"{argv[0]} 的输出不是 JSON：{detail}") from error
    failed = proc.returncode != 0 or (
        isinstance(data, dict) and ("error" in data or data.get("ok") is False)
    )
    if failed:
        raise ToolError(f"{' '.join(argv[:3])} 失败：{_reason(data, proc.stderr)}")
    return data


def _reason(data: object, stderr: str) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
    return stderr.strip()[:300] or "未知错误"
