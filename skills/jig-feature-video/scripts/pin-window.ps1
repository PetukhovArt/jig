# Restores the window titled exactly -Title, puts it at the top-left of the primary screen (-Secondary: of the first other screen)
# and sizes its client area to -Width x -Height physical pixels; at 100% scaling that equals CSS pixels, so `--pos` targets hold on any monitor.
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][int]$Width, [Parameter(Mandatory)][int]$Height, [switch]$Secondary)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Pin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
}
'@
Add-Type -AssemblyName System.Windows.Forms
[Pin]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: physical pixels on every screen
$screen = if ($Secondary) { [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1 } else { [System.Windows.Forms.Screen]::PrimaryScreen }
if (-not $screen) { "no secondary screen"; exit 1 }
$h = [Pin]::FindWindow([NullString]::Value, $Title)
if ($h -eq [IntPtr]::Zero) { "window not found: $Title"; exit 1 }

$area = $screen.WorkingArea
[Pin]::ShowWindow($h, 9) | Out-Null  # SW_RESTORE: a maximized window ignores MoveWindow
[Pin]::MoveWindow($h, $area.X, $area.Y, $Width, $Height, $true) | Out-Null
# The frame (invisible resize borders included) differs per window style and DPI: measure it, then size the window around the client area.
$outer = New-Object Pin+RECT; $client = New-Object Pin+RECT
[Pin]::GetWindowRect($h, [ref]$outer) | Out-Null
[Pin]::GetClientRect($h, [ref]$client) | Out-Null
$frameW = ($outer.Right - $outer.Left) - $client.Right
$frameH = ($outer.Bottom - $outer.Top) - $client.Bottom
[Pin]::MoveWindow($h, $area.X, $area.Y, $Width + $frameW, $Height + $frameH, $true) | Out-Null
"pinned '$Title' on $($screen.DeviceName): client ${Width}x${Height}"
