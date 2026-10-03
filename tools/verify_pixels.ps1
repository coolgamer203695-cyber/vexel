<#
.SYNOPSIS
  Pixel-level verification for Vexel Avalonia apps (and any desktop window).
  Launches the exe, captures it with PrintWindow (works covered/background),
  and asserts rendered colors at client-area points.
.DESCRIPTION
  Coordinates are Vexel client-area DIPs. The harness scales them by the
  system DPI (Graphics.DpiX/96), or an explicit -Scale for manual runs at
  125/150/200% (log out/in after changing OS scaling, then re-run).
  Asserts: "clientX,clientY,#RRGGBB,tolerance,label" (tolerance = max RGB
  euclidean distance). Prefix color with ! to assert ABSENCE.
  Exit 0 = all pass. Prints PASS/FAIL per assert with actual colors.
.EXAMPLE
  .\verify_pixels.ps1 -Exe .\ax_pixels.exe -Title "Ax Pixels" -Assert "70,50,#FF0000,80,red-center;15,50,!#FF0000,60,left-of-red"
#>
param(
  [string]$Exe,
  [string]$Title = "",
  [string]$Assert = "",
  [double]$Scale = 0,
  [int]$WaitMs = 5000
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct VP_POINT { public int x; public int y; }
[StructLayout(LayoutKind.Sequential)]
public struct VP_RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class VPWin {
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref VP_POINT p);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out VP_RECT r);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
}
"@

function Get-Scale() {
  if ($Scale -gt 0) { return $Scale }
  try {
    $g = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $d = $g.DpiX / 96.0
    $g.Dispose()
    return $d
  } catch { return 1.0 }
}

function ColorDist($a, $b) {
  $dr = $a.R - $b.R; $dg = $a.G - $b.G; $db = $a.B - $b.B
  return [math]::Sqrt($dr * $dr + $dg * $dg + $db * $db)
}

$p = Start-Process -FilePath $Exe -PassThru
try {
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $p.Refresh() } catch { }
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle; break }
  }
  if ($hwnd -eq [IntPtr]::Zero) { echo "FAIL no-window (app did not open)"; exit 1 }
  Start-Sleep -Milliseconds $WaitMs
  if ($Title -ne "") {
    $p.Refresh()
    if ($p.MainWindowTitle -ne $Title) { echo ("FAIL title: got '" + $p.MainWindowTitle + "' want '" + $Title + "'"); exit 1 }
    echo ("PASS title: " + $Title)
  }
  $scale = Get-Scale
  echo ("scale: " + $scale)
  # TOPMOST (no foreground permission needed) so nothing covers the app,
  # then capture the CLIENT area straight from the screen (works for any
  # rendering tech, unlike PrintWindow which goes black on DirectX).
  [VPWin]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
  Start-Sleep -Milliseconds 800
  $cr = New-Object VP_RECT
  [VPWin]::GetClientRect($hwnd, [ref]$cr) | Out-Null
  $cw = [int][math]::Round(($cr.Right - $cr.Left) * $scale)
  $ch = [int][math]::Round(($cr.Bottom - $cr.Top) * $scale)
  $org = New-Object VP_POINT
  $org.x = 0; $org.y = 0
  [VPWin]::ClientToScreen($hwnd, [ref]$org) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  try { $gfx.CopyFromScreen($org.x, $org.y, 0, 0, (New-Object System.Drawing.Size($cw, $ch))) }
  finally { $gfx.Dispose() }
  $fail = 0
  $asserts = @($Assert -split ';' | Where-Object { $_ -ne '' })
  foreach ($a in $asserts) {
    $parts = $a.Split(",")
    $cx = [double]$parts[0]; $cy = [double]$parts[1]
    $want = $parts[2]; $tol = [double]$parts[3]; $label = $parts[4]
    $negate = $false
    if ($want.StartsWith("!")) { $negate = $true; $want = $want.Substring(1) }
    $px = [int][math]::Round($cx * $scale)
    $py = [int][math]::Round($cy * $scale)
    # bitmap covers the client area 1:1 (already in physical pixels)
    $bx = $px
    $by = $py
    if ($bx -lt 0 -or $by -lt 0 -or $bx -ge $cw -or $by -ge $ch) {
      echo ("FAIL " + $label + ": point outside capture"); $fail++; continue
    }
    $got = $bmp.GetPixel($bx, $by)
    $wc = [System.Drawing.ColorTranslator]::FromHtml($want)
    $d = ColorDist $got $wc
    $ok = if ($negate) { $d -gt $tol } else { $d -le $tol }
    $hex = ('#{0:X2}{1:X2}{2:X2}' -f $got.R, $got.G, $got.B)
    if ($ok) { echo ("PASS " + $label + " (got " + $hex + ")") }
    else { echo ("FAIL " + $label + ": got " + $hex + " want " + $want + " (dist " + [int]$d + " tol " + $tol + ")"); $fail++ }
  }
  if ($fail -gt 0) { exit 1 }
  echo "ALL_PIXELS_OK"
  exit 0
} finally {
  try { Stop-Process -InputObject $p -Force -ErrorAction SilentlyContinue } catch { }
}
