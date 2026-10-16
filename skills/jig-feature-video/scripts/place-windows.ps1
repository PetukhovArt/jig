# Places top-level windows by title (-like pattern) on the primary work area: -Left left of -SplitX, -Right right of it.
# -SplitX is in physical pixels; default — half of the work area. A title that matches no window within -WaitSec fails with exit 1.
param([string]$Left = '', [string]$Right = '', [int]$SplitX = 0, [int]$WaitSec = 0)

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
}
'@
Add-Type -AssemblyName System.Windows.Forms
[Win]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: physical pixels on every screen
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
if ($SplitX -le 0) { $SplitX = [int]($area.Width / 2) }

function Find($pattern) {
  $script:found = $null
  [Win]::EnumWindows({ param($h, $l)
    # A minimized namesake (e.g. a hidden app window at -32000) must not be restored by mistake.
    if (-not $script:found -and [Win]::IsWindowVisible($h) -and -not [Win]::IsIconic($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [Win]::GetWindowText($h, $sb, 512) | Out-Null
      if ($sb.ToString() -like $pattern) { $script:found = [pscustomobject]@{ Handle = $h; Title = $sb.ToString() } }
    }
    $true }, [IntPtr]::Zero) | Out-Null
  $script:found
}

$failed = $false
function Place($pattern, $x, $w) {
  if (-not $pattern) { return }
  $deadline = (Get-Date).AddSeconds($WaitSec)
  $match = Find $pattern
  while (-not $match -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250; $match = Find $pattern }
  if (-not $match) { "not found: $pattern"; $script:failed = $true; return }
  [Win]::ShowWindow($match.Handle, 9) | Out-Null  # SW_RESTORE: a maximized window ignores MoveWindow
  [Win]::MoveWindow($match.Handle, $x, $area.Y, $w, $area.Height, $true) | Out-Null
  "placed '$($match.Title)' at x=$x w=$w h=$($area.Height)"
}

Place $Left $area.X ($SplitX - $area.X)
Place $Right $SplitX ($area.X + $area.Width - $SplitX)
if ($failed) { exit 1 }
