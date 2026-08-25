# build-sdk57.ps1 - Build release Android ClearNet (Expo SDK 57 / RN 0.86)
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build-sdk57.ps1
# Output (AAB): android\app\build\outputs\bundle\release\app-release.aab
$ErrorActionPreference = 'Stop'

# JDK: use existing JAVA_HOME, else fall back to a local JDK 17.
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "$env:LOCALAPPDATA\clearnet-jdk17" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:JAVA_HOME) { throw "No JDK found - set JAVA_HOME." }

# Android SDK
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if (-not (Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe")) { throw "Android SDK not found in ANDROID_HOME" }

# API URL baked at build time
if (-not $env:EXPO_PUBLIC_API_URL) { $env:EXPO_PUBLIC_API_URL = "https://localhost:8443/api" }

$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Write-Host "JAVA_HOME  = $env:JAVA_HOME"
Write-Host "ANDROID_HOME = $env:ANDROID_HOME"
Write-Host "API = $env:EXPO_PUBLIC_API_URL"
Write-Host "ABIs = arm64-v8a, armeabi-v7a"

Set-Location (Join-Path $PSScriptRoot "android")
& .\gradlew.bat :app:bundleRelease --no-daemon "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a"
exit $LASTEXITCODE
