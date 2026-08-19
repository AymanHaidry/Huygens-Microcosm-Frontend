from pathlib import Path
import shutil
from datetime import datetime

ROOT = Path(".")
HTML = ROOT / "app.html"
JS = ROOT / "assets" / "app.js"

def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{label}: expected exactly 1 match in {path}, found {count}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {path}: {label}")

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

# Backups: never overwrite the originals silently.
for path in (HTML, JS):
    if not path.exists():
        raise FileNotFoundError(path)
    backup = path.with_suffix(path.suffix + f".bak-{stamp}")
    shutil.copy2(path, backup)
    print(f"backup -> {backup}")

# 1) Fail-safe: the auth gate must be renderable even before JS initializes.
replace_once(
    HTML,
    '<div id="auth-gate" class="auth-gate hidden">',
    '<div id="auth-gate" class="auth-gate">',
    "make auth gate visible by default",
)

# 2) Auth flow: show the gate synchronously before touching Supabase.
replace_once(
    JS,
    """async function checkAuth() {
    if (!supabase) { showAuthGate(); return; }""",
    """async function checkAuth() {
    showAuthGate();
    if (!supabase) return;""",
    "show auth gate before Supabase session lookup",
)

print("\\nDone. Only the two targeted strings were changed.")
