param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
$point = New-Object Win+POINT; $point.X = $X; $point.Y = $Y
$hwnd = [Win]::WindowFromPoint($point)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NO WINDOW"; exit 0 }
$rect = New-Object Win+RECT; [Win]::GetWindowRect($hwnd, [ref]$rect)
$out = "hwnd=" + $hwnd + " rect=" + $rect.Left + "," + $rect.Top + " " + ($rect.Right-$rect.Left) + "x" + ($rect.Bottom-$rect.Top)
[Console]::WriteLine($out)