# Environment check for DJ mix track identification pipeline

Date: 2026-09-12
Machine: Arch Linux (Omarchy)

## 1. Package status

| Package | Installed version | Available from | Notes |
|---|---|---|---|
| yt-dlp | 2026.08.19-1 | core/extra (installed) | Ready to use. |
| ffmpeg | 2:9.0.1-4 | core/extra (installed) | Ready to use. |
| chromaprint (fpcalc) | not installed | extra 1.6.1-2 | Install with pacman. |
| python-pyacoustid | not installed | extra 1.3.1-1 | Also on pip as `pyacoustid` 1.3.1. |
| python-musicbrainzngs | not installed | extra 0.7.1-10 | Also on pip as `musicbrainzngs` 0.7.1. |
| python-librosa | not installed | extra 1.0.0-1 | Also on pip as `librosa` 1.0.0. |
| python-numpy | 2.5.3-1 | extra (installed) | Ready to use. |
| python-pydub | not installed | extra 0.25.1-8 | Also on pip as `pydub` 0.25.1. |
| songrec | not installed | extra 0.7.5-1 | Shazam-style fingerprint client. |
| shazamio (pip) | not installed | PyPI 0.8.1 | Async Shazam API client for Python. |
| python-shazamio | not installed | AUR 0.6.0-3 | Older version than pip. Prefer pip. |
| panako | not installed | not found (repo, AUR, or pip) | Java project, build from source (GitHub). |
| olaf | not installed | not found (repo, AUR, or pip) | C project, build from source (GitHub). |
| audfprint | not installed | not found (repo, AUR, or pip) | Python project, install from GitHub (no PyPI release). |
| dejavu | not installed | not found (repo, AUR); pip has `PyDejavu` 0.1.3 (unofficial fork) | Original `worldveil/dejavu` is GitHub-only, unmaintained. |
| sox | not installed | extra 14.8.0.1-1 | Optional audio utility. |
| aubio | not installed | extra 0.4.9-25 | Optional pitch/onset analysis. |
| essentia | not installed | not found (repo, AUR, or pip) | No prebuilt package. Build from source (GitHub) if needed. |
| jdk-openjdk | 26.0.2.1.u1-1 | core (installed) | Java 26 runtime, needed for Panako. |
| rust / cargo | 1.98.1 | core (installed) | Ready to use. |
| uv | not installed | extra 0.12.10-1 (pacman); PyPI 0.12.13 (pip) | Fast Python package manager. |

Other checks:
- Python: 3.14.7 (`python`/`python3`)
- Java: OpenJDK 26.0.2.1
- Cargo: 1.98.1

## 2. Machine resources

- Disk free on `/home` (holds `~`): 113G free of 231G (51% used)
- CPU cores: 12
- RAM: 31 GiB total, 1.7 GiB free, 10 GiB available (11 GiB in buff/cache)
- Swap: 31 GiB total, 410 MiB used

The machine has enough disk, CPU, and RAM for the base pipeline and for heavier tools like Essentia or Panako if built from source.

## 3. Suggested install commands for the base pipeline (do not run yet)

Base pipeline: yt-dlp, ffmpeg, chromaprint, pyacoustid, musicbrainzngs.

System packages (pacman, needed for the `fpcalc` binary and Java toolchain reuse):
```
sudo pacman -S chromaprint
```

Python environment with `uv`, in a venv at `/home/irae/code/set-brainz/.venv`:
```
uv venv /home/irae/code/set-brainz/.venv
uv pip install --python /home/irae/code/set-brainz/.venv/bin/python pyacoustid musicbrainzngs
```

`yt-dlp` and `ffmpeg` are already installed system-wide, so the venv does not need them unless isolation is required.

Alternative with plain `pip` (if `uv` is not installed first):
```
python -m venv /home/irae/code/set-brainz/.venv
/home/irae/code/set-brainz/.venv/bin/pip install pyacoustid musicbrainzngs
```
