# Prints the client area of the visible window titled exactly -Title as "x,y,w,h" in physical pixels, and sets or clears its TOPMOST flag.
# fv.mjs records that desktop region instead of gdigrab title=: a GPU-rendered window (Tauri/WebView2) reads back frozen on its first frame through the window DC.
param([Parameter(Mandatory)][string]$Title, [int]$Topmost = 1)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinArea {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
}
'@
# Per-monitor, not system DPI awareness: on monitors with different scaling a system-aware process gets a rescaled rect that falls outside the gdigrab desktop.
[WinArea]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
$h = [WinArea]::FindWindow([NullString]::Value, $Title)  # a plain $null reaches C# as "", a class name no window has
if ($h -eq [IntPtr]::Zero) { "window not found: $Title"; exit 1 }

$insertAfter = if ($Topmost) { [IntPtr](-1) } else { [IntPtr](-2) }  # HWND_TOPMOST / HWND_NOTOPMOST
[WinArea]::SetWindowPos($h, $insertAfter, 0, 0, 0, 0, 0x3) | Out-Null  # SWP_NOSIZE | SWP_NOMOVE

$rect = New-Object WinArea+RECT
[WinArea]::GetClientRect($h, [ref]$rect) | Out-Null
$origin = New-Object WinArea+POINT
[WinArea]::ClientToScreen($h, [ref]$origin) | Out-Null
"$($origin.X),$($origin.Y),$($rect.Right),$($rect.Bottom)"
