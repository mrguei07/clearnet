@echo off
setlocal
rem ---------------------------------------------------------------------------
rem create-release-keystore.cmd - cree le keystore de release ClearNet (hors repo).
rem Stockage : %USERPROFILE%\.clearnet-keys\  (a copier dans un gestionnaire de secrets)
rem REGLES : jamais commiter ces fichiers, jamais les partager.
rem ---------------------------------------------------------------------------
set KEY_DIR=%USERPROFILE%\.clearnet-keys
set KS=%KEY_DIR%\clearnet-release.jks
set PW=%KEY_DIR%\keystore-password.txt
if not defined JAVA_HOME set JAVA_HOME=%LOCALAPPDATA%\Temp\opencode\jdk17\jdk-17.0.20+8

if exist "%KS%" (
  echo [INFO] Keystore deja present : "%KS%"
  exit /b 0
)
if not exist "%KEY_DIR%" mkdir "%KEY_DIR%"

set PWFILE=%PW%
for /f "delims=" %%p in ('powershell -NoProfile -Command "$chars=(33..126 | Get-Random -Count 24 | ForEach-Object {[char]$_}) -join ''; Set-Content -LiteralPath $env:PWFILE -Value $chars -NoNewline; Write-Output $chars"') do set KPW=%%p
set PWFILE=
if not defined KPW (
  echo [ERREUR] generation du mot de passe impossible
  exit /b 1
)

set TRY=0
:keytool_retry
"%JAVA_HOME%\bin\keytool.exe" -genkeypair -alias clearnet -keyalg RSA -keysize 2048 -validity 10000 ^
  -keystore "%KS%" -storepass %KPW% -keypass %KPW% -dname "CN=ClearNet, OU=DevOps, O=ClearNet, L=Paris, ST=Ile-de-France, C=FR"
if not errorlevel 1 goto keytool_ok
set /a TRY+=1
if %TRY% GEQ 3 (
  echo [ERREUR] keytool a echoue apres 3 tentatives
  exit /b 1
)
echo [INFO] verrou transitoire - nouvelle tentative (%TRY%/3)...
timeout /t 3 /nobreak >nul
goto keytool_retry
:keytool_ok

echo [OK] Keystore cree : "%KS%"
echo [OK] Mot de passe    : "%PW%"
echo [OK] Copier les DEUX fichiers dans un gestionnaire de secrets avant tout usage.
echo [OK] Signature release : zipalign puis apksigner sign --ks "%KS%" -v app-release.apk
exit /b 0