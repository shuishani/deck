import json
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path

Runner = Callable[[Sequence[str]], dict]


class ToolError(Exception):
    """外部 CLI 调用失败，或返回了错误结果。"""

    def __init__(self, message: str, definite: bool = False):
        super().__init__(message)
        # True：命令确定没有执行成功（找不到命令、明确报错）；超时、输出异常时可能已生效。
        self.definite = definite


def run_json(argv: Sequence[str], timeout: int = 120, cwd: str | None = None) -> dict:
    try:
        proc = subprocess.run(
            list(argv), capture_output=True, text=True, timeout=timeout, cwd=cwd
        )
    except FileNotFoundError as error:
        raise ToolError(f"找不到命令 {argv[0]}，请检查 config.toml 的 [tools] 配置", definite=True) from error
    except subprocess.TimeoutExpired as error:
        raise ToolError(f"{argv[0]} 超过 {timeout} 秒未响应") from error
    out = proc.stdout.strip()
    try:
        data = json.loads(out) if out else {}
    except json.JSONDecodeError as error:
        detail = out[:200] or proc.stderr.strip()[:200]
        raise ToolError(f"{argv[0]} 的输出不是有效的 JSON：{detail}") from error
    failed = proc.returncode != 0 or (
        isinstance(data, dict) and ("error" in data or data.get("ok") is False)
    )
    if failed:
        raise ToolError(f"{_command(argv)} 失败：{_reason(data, proc.stderr)}", definite=True)
    return data


def _command(argv: Sequence[str]) -> str:
    """报错里只写命令名和子命令，不暴露本机路径和参数值。"""
    words = [Path(argv[0]).name]
    for word in argv[1:]:
        if word.startswith("-") or len(words) >= 4:
            if word == "--json":
                continue
            break
        words.append(word)
    return " ".join(words)


def _reason(data: object, stderr: str) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
    return stderr.strip()[:300] or "未知错误"
