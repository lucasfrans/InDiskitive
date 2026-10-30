# Builds an unsigned .msix for upload to Microsoft Partner Center (the Store signs it).
#
#   .\build-msix.ps1 -IdentityName "12345LucasFransen.InDiskitive" `
#                    -Publisher "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" `
#                    -PublisherDisplayName "Lucas Fransen"
#
# The three identity values come from Partner Center: Product management > Product identity.
param(
  [Parameter(Mandatory)] [string] $IdentityName,
  [Parameter(Mandatory)] [string] $Publisher,
  [Parameter(Mandatory)] [string] $PublisherDisplayName,
  [string] $Version = "0.1.0.0",   # four parts; the last must be 0 for Store packages
  [string] $Exe = "",
  [string] $Icons = "",
  [string] $OutDir = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Icons)  { $Icons  = Join-Path $here "..\src-tauri\icons" }
if (-not $OutDir) { $OutDir = Join-Path $here "out" }
if (-not $Exe)    { $Exe    = Join-Path $here "..\src-tauri\target\release\indiskitive.exe" }

if (-not (Test-Path $Exe)) { throw "Exe not found: $Exe (build with: npx tauri build --no-bundle)" }
$makeappx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found. Install the Windows 10/11 SDK." }
if ($Version -notmatch '^\d+\.\d+\.\d+\.0$') { throw "Version must look like 1.2.3.0 (last part 0)." }

$stage = Join-Path $env:TEMP "indiskitive-msix"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory "$stage\Assets" | Out-Null

Copy-Item $Exe "$stage\indiskitive.exe"
foreach ($n in "StoreLogo","Square44x44Logo","Square71x71Logo","Square150x150Logo") {
  Copy-Item (Join-Path $Icons "$n.png") "$stage\Assets\$n.png"
}

$xml = Get-Content (Join-Path $here "AppxManifest.template.xml") -Raw
$xml = $xml.Replace("{{IDENTITY_NAME}}", $IdentityName).Replace("{{PUBLISHER}}", $Publisher).
  Replace("{{PUBLISHER_DISPLAY}}", $PublisherDisplayName).Replace("{{VERSION}}", $Version)
[IO.File]::WriteAllText("$stage\AppxManifest.xml", $xml, (New-Object System.Text.UTF8Encoding($false)))

New-Item -ItemType Directory -Force $OutDir | Out-Null
$out = Join-Path $OutDir "InDiskitive_${Version}_x64.msix"
& $makeappx.FullName pack /d $stage /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }
Write-Host "`nBuilt: $out"
