Set-Location -LiteralPath $PSScriptRoot
$port = 8000
Write-Host "Starting Desmon Run at http://localhost:$port/game/" -ForegroundColor Green
Start-Process "http://localhost:$port/game/"
python -m http.server $port
