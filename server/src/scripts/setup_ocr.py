"""Install the local OCR environment and download its models."""
import os
from pathlib import Path
import subprocess
import tempfile
import venv


server = Path(__file__).resolve().parents[2]
env_dir = server / ".venv-ocr"
venv.create(env_dir, with_pip=True)
python = env_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
cache = Path(tempfile.gettempdir()) / "invoice-pip-cache"
subprocess.run([
    str(python), "-m", "pip", "install", "--cache-dir", str(cache),
    "--timeout", "60", "--retries", "5", "-r", str(server / "requirements-ocr.txt"),
], check=True)
subprocess.run([str(python), "-X", "utf8", str(server / "src/parse/rapidocr_worker.py"), "--warmup"], check=True)

