# Performs a real OS-level drag operation on a window.
param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [Parameter(Mandatory = $true)][double]$StartCssX,
  [Parameter(Mandatory = $true)][double]$StartCssY,
  [Parameter(Mandatory = $true)][double]$EndCssX,
  [Parameter(Mandatory = $true)][double]$EndCssY,
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

$startX = [int]($rect.Left + ($StartCssX * $scaleX))
$startY = [int]($rect.Top + ($StartCssY * $scaleY))
$endX = [int]($rect.Left + ($EndCssX * $scaleX))
$endY = [int]($rect.Top + ($EndCssY * $scaleY))

[void][Win]::SetCursorPos($startX, $startY)
Start-Sleep -Milliseconds 150
[Win]::mouse_event([Win]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 200

# Smooth drag in 10 steps
for ($i = 1; $i -le 10; $i++) {
  $x = [int]($startX + ($endX - $startX) * $i / 10)
  $y = [int]($startY + ($endY - $startY) * $i / 10)
  [void][Win]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 30
}

[Win]::mouse_event([Win]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 150
Write-Output "dragged from $startX,$startY to $endX,$endY"