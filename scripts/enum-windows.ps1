Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$h = [Win]::GetTopWindow([IntPtr]::Zero)
$lines = New-Object System.Collections.Generic.List[string]
while ($h -ne [IntPtr]::Zero) {
  $rect = New-Object Win+RECT
  [Win]::GetWindowRect($h, [ref]$rect)
  $len = [Win]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder $len + 1
  [void][Win]::GetWindowText($h, $sb, $len + 1)
  $visible = [Win]::IsWindowVisible($h)
  $w = $rect.Right - $rect.Left
  $hgt = $rect.Bottom - $rect.Top
  if ($visible -and $w -gt 10 -and $hgt -gt 10) {
    $lines.Add("hwnd=$h title='$($sb.ToString())' rect=$($rect.Left),$($rect.Top) ${w}x${hgt}")
  }
  $h = [Win]::GetWindow($h, 2)
}
$lines -join "`n"