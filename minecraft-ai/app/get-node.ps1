# Downloads a private copy of Node.js 22 into data\runtime\node (used by "Start Minecraft AI.bat").
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data\runtime'
$base = 'https://nodejs.org/dist/latest-v22.x/'
$sums = (Invoke-WebRequest ($base + 'SHASUMS256.txt') -UseBasicParsing).Content -split "`n"
$line = $sums | Where-Object { $_ -match 'win-x64\.zip$' } | Select-Object -First 1
$hash, $file = ($line.Trim() -split '\s+')
New-Item -ItemType Directory -Force $runtime | Out-Null
$zip = Join-Path $runtime 'node.zip'
Invoke-WebRequest ($base + $file) -OutFile $zip -UseBasicParsing
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash.ToUpper()) { throw 'Node.js download was corrupted, please try again.' }
$tmp = Join-Path $runtime 'node-tmp'
Expand-Archive $zip $tmp -Force
Move-Item (Get-ChildItem $tmp)[0].FullName (Join-Path $runtime 'node')
Remove-Item $zip, $tmp -Recurse -Force
