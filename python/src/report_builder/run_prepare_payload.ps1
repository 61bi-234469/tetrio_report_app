param(
    [int[]]$Chapters = @(1,2,3,4,5,6,7,8,9,10,11,12)
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$argsList = @("$Root\scripts\prepare_ai_payload.py", "--chapters") + $Chapters
python @argsList
