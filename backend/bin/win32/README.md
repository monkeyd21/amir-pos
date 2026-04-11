# Windows Print Spooler helper

This directory contains `rawprint.ps1`, a PowerShell script that sends raw
bytes to a Windows Print Spooler queue via direct Win32 API P/Invoke.

## Why it exists

Node.js has no cross-version-stable way to write raw bytes to a Windows
printer. Native bindings like `@thiagoelg/node-printer` break on every
Node major, and `Out-Printer` corrupts binary data. The only reliable path
is the Win32 Print Spooler API (`OpenPrinter` / `StartDocPrinter` /
`WritePrinter`), which we reach via a small PowerShell script that uses
inline C# `Add-Type -Language CSharp`.

## How it's invoked

The `win-spool` transport in
`backend/src/modules/printing/transports/win-spool.transport.ts` shells out:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File rawprint.ps1 \
  "<printer queue name>" "<path-to-tempfile>"
```

The printer queue name must match *exactly* the name in
**Settings → Printers & Scanners** (case-insensitive).

## Requirements

- Windows 7 SP1 or later (PowerShell 2.0+ is pre-installed)
- The user running the backend process must have permission to print to
  the target queue (they do by default for any printer they installed
  themselves)
- No binary, no DLL, no native build — just a text script

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | Bad arguments |
| 2    | File not found |
| 3    | `OpenPrinter` failed — printer name typo or permission denied |
| 4    | `StartDocPrinter` / `StartPagePrinter` failed — printer offline or paused |
| 5    | `WritePrinter` failed |
