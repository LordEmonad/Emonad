# Update meme_list.js with all images from the memes folder
$memesFolder = Join-Path $PSScriptRoot "memes"
$outputFile = Join-Path $PSScriptRoot "meme_list.js"

# Get all image files
$images = Get-ChildItem -Path $memesFolder -File | Where-Object {
    $_.Extension -match '\.(jpg|jpeg|png|gif|webp)$'
} | Sort-Object Name | ForEach-Object { $_.Name }

# Build the JavaScript content
$jsContent = "// Auto-generated meme list - Run update_memes.ps1 to refresh`n"
$jsContent += "const MEME_FILES = [`n"

for ($i = 0; $i -lt $images.Count; $i++) {
    $comma = if ($i -lt $images.Count - 1) { "," } else { "" }
    $jsContent += "  `"$($images[$i])`"$comma`n"
}

$jsContent += "];"

# Write to file
$jsContent | Out-File -FilePath $outputFile -Encoding UTF8

Write-Host "Updated meme_list.js with $($images.Count) images!" -ForegroundColor Green
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
