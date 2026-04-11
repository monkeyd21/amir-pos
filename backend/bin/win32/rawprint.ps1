# ───────────────────────────────────────────────────────────────────────
# rawprint.ps1 — send raw bytes to a Windows Print Spooler queue
#
# Why this exists:
#   Node.js has no built-in way to write raw bytes to a Windows printer.
#   PowerShell's built-in `Out-Printer` cmdlet doesn't handle binary data
#   correctly — it corrupts thermal printer command languages (TSPL, ZPL,
#   EPL2) by treating them as text. The only reliable path is the Win32
#   Print Spooler API (OpenPrinter / StartDocPrinter / WritePrinter),
#   which we reach via inline C# P/Invoke.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass `
#     -File rawprint.ps1 "<Printer Name>" "<path-to-file>"
#
# Exit codes:
#   0   success
#   1   bad arguments
#   2   file not found
#   3   OpenPrinter failed (usually: printer name typo, or user has no
#       access to the queue)
#   4   StartDocPrinter / StartPagePrinter failed
#   5   WritePrinter failed
#
# Why inline C#:
#   We add the P/Invoke signatures via `Add-Type` with CSharp language.
#   This compiles to an in-memory assembly on first run (~200ms) and is
#   cached for subsequent calls within the same PowerShell session.
#   There is no file written to disk, no persistence, no DLL.
# ───────────────────────────────────────────────────────────────────────

param(
    [Parameter(Mandatory = $true, Position = 0)][string] $PrinterName,
    [Parameter(Mandatory = $true, Position = 1)][string] $FilePath
)

if (-not (Test-Path -LiteralPath $FilePath)) {
    [Console]::Error.WriteLine("rawprint: file not found: $FilePath")
    exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "OpenPrinterW", SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "StartDocPrinterW", SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOCINFOW di);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static int Send(string printerName, byte[] data) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            return 3;
        }
        try {
            DOCINFOW di;
            di.pDocName = "ClothingERP Label";
            di.pOutputFile = null;
            di.pDataType = "RAW";
            if (!StartDocPrinter(hPrinter, 1, ref di)) return 4;
            try {
                if (!StartPagePrinter(hPrinter)) return 4;
                IntPtr unmanagedBuf = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, unmanagedBuf, data.Length);
                    int written;
                    if (!WritePrinter(hPrinter, unmanagedBuf, data.Length, out written)) return 5;
                } finally {
                    Marshal.FreeCoTaskMem(unmanagedBuf);
                }
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return 0;
    }
}
'@ -Language CSharp -ErrorAction Stop

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$result = [RawPrinter]::Send($PrinterName, $bytes)

if ($result -ne 0) {
    $errCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    switch ($result) {
        3 { [Console]::Error.WriteLine("rawprint: OpenPrinter failed (Win32 error $errCode). Check that the printer name exactly matches the queue in Settings → Printers & Scanners.") }
        4 { [Console]::Error.WriteLine("rawprint: StartDocPrinter/StartPagePrinter failed (Win32 error $errCode). The printer is probably offline or paused.") }
        5 { [Console]::Error.WriteLine("rawprint: WritePrinter failed (Win32 error $errCode).") }
    }
    exit $result
}

exit 0
