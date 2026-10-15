"""Run a student's Java program and report what it printed.

`CodeRunner` is the interface the rest of the service uses. `LocalJavaRunner` is the
DEVELOPMENT implementation: it compiles and runs the program with the JDK on this machine,
in a throwaway folder, with a time limit, a memory limit and a cap on how much it may print.

It is not a sandbox. The program runs as the user who started the service, and a hostile one
could read files or use the network. That is acceptable for a demo among trusted people and is
why the architecture says student code must never run inside the tutor service in production:
the planned `PistonRunner` (an isolated container, from phase P4) replaces this class behind
the same interface, and nothing else changes.
"""

from __future__ import annotations

import contextlib
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

MAX_SOURCE_CHARS = 20_000
MAX_STDIN_CHARS = 10_000


class RunnerUnavailable(Exception):
    """No way to run Java on this machine (no JDK found, or the runner is off)."""


@dataclass(frozen=True)
class RunResult:
    status: str  # ok | runtime_error | timeout | output_limit
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    ms: int = 0


@dataclass(frozen=True)
class Batch:
    """One compile and the runs that followed it, one per input."""

    compiled: bool
    compile_output: str = ""
    runs: Sequence[RunResult] = field(default_factory=tuple)


class CodeRunner(Protocol):
    def run_batch(self, source: str, stdins: Sequence[str]) -> Batch:
        """Compile `source` once and run it once for each input, in order."""
        ...


class LocalJavaRunner:
    def __init__(
        self,
        *,
        compile_timeout: float = 20.0,
        run_timeout: float = 5.0,
        max_output: int = 64_000,
        max_parallel: int = 2,
    ) -> None:
        self.compile_timeout = compile_timeout
        self.run_timeout = run_timeout
        self.max_output = max_output
        # Compiling is heavy. A few students at once is fine; a crowd would stall the service.
        self._slots = threading.BoundedSemaphore(max_parallel)

    # ---------------------------------------------------------------- public
    def available(self) -> bool:
        return self._tool("javac") is not None and self._tool("java") is not None

    def run_batch(self, source: str, stdins: Sequence[str]) -> Batch:
        javac, java = self._tool("javac"), self._tool("java")
        if javac is None or java is None:
            raise RunnerUnavailable("No JDK was found. Install one and put javac on the PATH.")
        if len(source) > MAX_SOURCE_CHARS:
            return Batch(False, f"The program is too long (over {MAX_SOURCE_CHARS} characters).")

        with (
            self._slots,
            tempfile.TemporaryDirectory(prefix="practical-", ignore_cleanup_errors=True) as folder,
        ):
            work = Path(folder)
            (work / "Main.java").write_text(source, encoding="utf-8", newline="\n")

            started = self._exec(
                [javac, "-encoding", "UTF-8", "-d", str(work), str(work / "Main.java")],
                work,
                "",
                self.compile_timeout,
            )
            if started.status != "ok" or started.exit_code != 0:
                message = started.stderr or started.stdout or "The program did not compile."
                if started.status == "timeout":
                    message = "Compiling took too long."
                return Batch(False, _tidy(message, work))

            runs = [
                self._exec(
                    [
                        java,
                        "-Xmx128m",
                        "-Xss512k",
                        "-XX:+UseSerialGC",
                        "-XX:TieredStopAtLevel=1",
                        "-Dfile.encoding=UTF-8",
                        "-cp",
                        str(work),
                        "Main",
                    ],
                    work,
                    stdin[:MAX_STDIN_CHARS],
                    self.run_timeout,
                )
                for stdin in stdins
            ]
            return Batch(True, "", tuple(self._finish(r, work) for r in runs))

    # --------------------------------------------------------------- helpers
    @staticmethod
    def _tool(name: str) -> str | None:
        found = shutil.which(name)
        if found:
            return found
        home = os.environ.get("JAVA_HOME")
        if home:
            candidate = Path(home) / "bin" / (name + (".exe" if os.name == "nt" else ""))
            if candidate.exists():
                return str(candidate)
        return None

    @staticmethod
    def _finish(result: RunResult, work: Path) -> RunResult:
        if result.status == "ok" and result.exit_code not in (0, None):
            return RunResult(
                "runtime_error",
                result.stdout,
                _tidy(result.stderr, work),
                result.exit_code,
                result.ms,
            )
        return RunResult(
            result.status, result.stdout, _tidy(result.stderr, work), result.exit_code, result.ms
        )

    def _exec(self, command: list[str], cwd: Path, stdin: str, timeout: float) -> RunResult:
        """Run one process with a time limit and a cap on its output."""
        environment = {
            key: os.environ[key]
            for key in ("PATH", "SYSTEMROOT", "TEMP", "TMP", "JAVA_HOME")
            if key in os.environ
        }
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        began = time.perf_counter()
        process = subprocess.Popen(  # noqa: S603 (a fixed command; the student's text is only stdin)
            command,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            creationflags=flags,
            start_new_session=os.name != "nt",  # its own process group, so it can be killed whole
        )

        captured = {"out": b"", "err": b"", "over": False}

        def read(stream, key: str) -> None:
            while True:
                chunk = stream.read(4096)
                if not chunk:
                    return
                captured[key] += chunk
                if len(captured[key]) > self.max_output:
                    captured["over"] = True
                    _kill_tree(process)
                    return

        def feed() -> None:
            try:
                process.stdin.write(stdin.encode("utf-8"))
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass  # the program ended before reading everything, which is its own business

        threads = [
            threading.Thread(target=read, args=(process.stdout, "out"), daemon=True),
            threading.Thread(target=read, args=(process.stderr, "err"), daemon=True),
            threading.Thread(target=feed, daemon=True),
        ]
        for thread in threads:
            thread.start()

        status = "ok"
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(process)
            status = "timeout"
        # A killed process can keep its folder locked for a moment on Windows, so wait for it
        # to be really gone before anyone tries to delete the folder.
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=5)
        for thread in threads:
            thread.join(timeout=2)
        if captured["over"]:
            status = "output_limit"

        return RunResult(
            status,
            _text(captured["out"], self.max_output),
            _text(captured["err"], self.max_output),
            process.returncode,
            int((time.perf_counter() - began) * 1000),
        )


def _text(raw: bytes, limit: int) -> str:
    """Program output as text, with Windows line endings made plain so the same program gives
    the same answer on every machine."""
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n")[:limit]


def _kill_tree(process: subprocess.Popen) -> None:
    """Kill the process and everything it started.

    On Windows the `java` on the PATH is often a launcher that starts the real JVM as a child,
    so killing only the process we started would leave the student's program running forever.
    """
    if os.name == "nt":
        subprocess.run(  # noqa: S603
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],  # noqa: S607
            capture_output=True,
            check=False,
        )
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError):
        process.kill()


def _tidy(text: str, work: Path) -> str:
    """Error text without this machine's temporary folder in it."""
    cleaned = text.replace(str(work) + os.sep, "").replace(str(work), "")
    return re.sub(r"\r\n?", "\n", cleaned).strip()[:4000]
