# Clicks a point inside a window, using the window's own HWND.
param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [Parameter(Mandatory = $true)][double]$CssX,
  [Parameter(Mandatory = $true)][double]$CssY,
  [Parameter(Mandatory = $true)][double]$CssWidth,
  [Parameter(Mandatory = $true)][double]$CssHeight
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
}
"@
$handle = [IntPtr]::new([Int64]$Hwnd)
$rect = New-Object Win+RECT
if (-not [Win]::GetWindowRect($handle, [ref]$rect)) { Write-Output "GetWindowRect failed"; exit 1 }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$scaleX = $width / $CssWidth
$scaleY = $height / $CssHeight
$targetX = [int]($rect.Left + ($CssX * $scaleX))
$targetY = [int]($rect.Top + ($CssY * $scaleY))
[void][Win]::SetCursorPos($targetX, $targetY)
Start-Sleep -Milliseconds 250
[Win]::mouse_event([Win]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Win]::mouse_event([Win]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 250
Write-Output "clicked"