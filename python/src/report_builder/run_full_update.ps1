param(
    [Parameter(Mandatory=$true)]
    [string]$Csv,
    [string]$Player = "your_username",
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArgsList = @("-DataFile", $Csv, "-Player", $Player)
if ($Force) { $ArgsList += "-Force" }
& (Join-Path $Root "make_report.ps1") @ArgsList
