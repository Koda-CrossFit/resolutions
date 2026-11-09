# Screenshot of the local dev app, signed in as someone (wraps dev/shot.js, which uses Playwright
# with real viewport emulation; headless Edge can't render narrower than ~500px).
# .\dev\shot.ps1 -To "#/progress" -W 390 -H 844 -Out C:\path\shot.png [-Email demo@koda.test -Password koda2027] [-Dark] [-SignedOut]
# A tall -H (e.g. 1800) captures more of the page.
param(
  [string]$To = '#/today',
  [int]$W = 390,
  [int]$H = 844,
  [string]$Out,
  [string]$Email = 'demo@koda.test',
  [string]$Password = 'koda2027',
  [switch]$Dark,
  [switch]$SignedOut
)
$script = Join-Path $PSScriptRoot 'shot.js'
$argsList = @($script, '--to', $To, '--w', "$W", '--h', "$H", '--out', $Out, '--email', $Email, '--password', $Password)
if ($Dark) { $argsList += '--dark' }
if ($SignedOut) { $argsList += '--signed-out' }
& node @argsList
