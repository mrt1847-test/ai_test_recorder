$folder = ([string][char]0xBB38) + ([string][char]0xC11C)
$basePath = Join-Path -Path "C:\Users\cease\OneDrive" -ChildPath $folder
$projectPath = Join-Path -Path $basePath -ChildPath "GitHub\ai_test_recorder"
Push-Location $projectPath
try {
  node scripts/build.js
} finally {
  Pop-Location
}

