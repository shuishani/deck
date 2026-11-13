"""macOS 钥匙串：密钥只存在这里，deck 的库和配置里只记条目名。"""
import subprocess


def read(item: str) -> str:
    """没有这个条目（或不在 macOS 上）时返回空。"""
    try:
        found = subprocess.run(["security", "find-generic-password", "-s", item, "-w"],
                               capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    return found.stdout.strip() if found.returncode == 0 else ""


def write(item: str, value: str) -> None:
    try:
        done = subprocess.run(["security", "add-generic-password", "-U", "-s", item, "-a", "deck", "-w", value],
                              capture_output=True, text=True, timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        raise ValueError("无法写入钥匙串：只支持在 macOS 上运行的 deck") from None
    if done.returncode != 0:
        raise ValueError("写入钥匙串失败，请在运行 deck 的电脑上检查钥匙串权限")
