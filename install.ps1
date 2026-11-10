# Job Finder installer (Windows). Re-run any time to update: profile\, data\ and .env are never touched.
#   irm https://raw.githubusercontent.com/jdragon3001/job-finder/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$Repo = 'jdragon3001/job-finder'
$Dir = if ($env:JOB_FINDER_DIR) { $env:JOB_FINDER_DIR } else { "$HOME\job-finder" }
$RT = "$Dir\.runtime"; $Tmp = "$RT\download"
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
function Say($m) { Write-Host "`n$m" -ForegroundColor Cyan }
function Ok($what) { if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)" } }
function Fetch($url, $out) { curl.exe -fsSL -o $out $url; Ok "Download $url" }
# ponytail: PowerShell 5.1 turns a native command's stderr into a terminating error under 'Stop'; probe with 'Continue'
function Works([scriptblock]$sb) { $ErrorActionPreference = 'Continue'; try { & $sb *> $null; $LASTEXITCODE -eq 0 } catch { $false } }
New-Item -ItemType Directory -Force $Tmp | Out-Null
$env:Path = "$RT\node;$RT\bin;$HOME\.local\bin;$env:Path"

Say "Downloading Job Finder to $Dir"
Fetch "https://github.com/$Repo/archive/refs/heads/main.tar.gz" "$Tmp\src.tgz"
tar.exe -xzf "$Tmp\src.tgz" -C $Dir --strip-components=1; Ok 'Unpack'

if (-not (Works { node -e "require('node:sqlite')" })) {
  Say 'Installing Node (private copy, no admin needed)'
  $f = (curl.exe -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | Where-Object { $_ -match "-win-$Arch\.zip$" }) -replace '^\S+\s+'
  Fetch "https://nodejs.org/dist/latest-v24.x/$f" "$Tmp\node.zip"
  if (Test-Path "$RT\node") { Remove-Item -Recurse -Force "$RT\node" }
  New-Item -ItemType Directory "$RT\node" | Out-Null
  tar.exe -xf "$Tmp\node.zip" -C "$RT\node" --strip-components=1; Ok 'Unpack Node'
}

# Always a private Python: on Windows `python3` is usually the Microsoft Store stub, not a real Python.
Say 'Setting up Python (private copy)'
if (-not (Test-Path "$RT\bin\uv.exe")) {
  $env:UV_UNMANAGED_INSTALL = "$RT\bin"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null; Ok 'uv install'
}
$env:UV_PYTHON_INSTALL_DIR = "$RT\python"
& "$RT\bin\uv.exe" python install 3.12 --python-preference only-managed *> $null; Ok 'Python install'
$Py = Split-Path (& "$RT\bin\uv.exe" python find 3.12 --python-preference only-managed)
Copy-Item "$Py\python.exe" "$Py\python3.exe" -Force   # the app and its prompts call `python3`

# Claude runs the app's scripts through Bash; Git Bash is the Windows bash, dropped in privately.
if (-not (Test-Path "$RT\git\bin\bash.exe")) {
  Say 'Installing Git Bash (private copy)'
  $rel = Invoke-RestMethod https://api.github.com/repos/git-for-windows/git/releases/latest
  $url = ($rel.assets | Where-Object name -like 'PortableGit-*-64-bit.7z.exe' | Select-Object -First 1).browser_download_url
  Fetch $url "$Tmp\git.exe"
  Start-Process -Wait -FilePath "$Tmp\git.exe" -ArgumentList "-o`"$RT\git`"", '-y'
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Say 'Installing Claude Code'
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"; Ok 'Claude Code install'
}
$env:CLAUDE_CODE_GIT_BASH_PATH = "$RT\git\bin\bash.exe"
$status = & { $ErrorActionPreference = 'Continue'; claude auth status --json 2>$null } | Out-String
if ($status -notmatch '"loggedIn":\s*true') {
  Say 'Log in to Claude (uses your own Claude subscription)'
  claude auth login; Ok 'Claude login'
}

Say 'Building the app (a minute or two)'
Set-Location $Dir
npm ci --omit=dev --no-audit --no-fund --loglevel=error; Ok 'npm ci'
npm run build | Out-Null; Ok 'Build'

$Start = "$Dir\Start Job Finder.cmd"
@"
@echo off
title Job Finder
set "PATH=$RT\node;$Py;%USERPROFILE%\.local\bin;%PATH%"
set "CLAUDE_CODE_GIT_BASH_PATH=$RT\git\bin\bash.exe"
set PYTHONUTF8=1
cd /d "$Dir"
start "" /min cmd /c "timeout /t 5 >nul & start http://localhost:3456"
npm start
"@ | Set-Content -Encoding ASCII $Start
Remove-Item -Recurse -Force $Tmp

Say "Done. Double-click 'Start Job Finder' in $Dir to run it."
Write-Host "Then open Profile in the dashboard: upload your resume and tell Claude what you are looking for."
Invoke-Item $Dir
