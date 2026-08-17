@echo off
setlocal
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem build-gradle.cmd - Build release Android ClearNet V1.4.
rem Local : pose les chemins par defaut (%LOCALAPPDATA%). CI : honore les
rem variables d'environnement deja definies (JAVA_HOME, ANDROID_HOME, NDK,
rem GRADLE_HOME_BIN, EXPO_PUBLIC_API_URL). Exit code = exit code de Gradle.
rem IMPORTANT : fichier 100% ASCII (cmd.exe + codepage OEM).
rem ---------------------------------------------------------------------------

if not defined JAVA_HOME           set JAVA_HOME=%LOCALAPPDATA%\Temp\opencode\jdk17\jdk-17.0.20+8
if not defined ANDROID_HOME        set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
if not defined ANDROID_SDK_ROOT    set ANDROID_SDK_ROOT=%ANDROID_HOME%
if not defined ANDROID_NDK_HOME    set ANDROID_NDK_HOME=%ANDROID_HOME%\ndk\26.3.11579264
if not defined ANDROID_NDK_ROOT    set ANDROID_NDK_ROOT=%ANDROID_NDK_HOME%
if not defined GRADLE_HOME_BIN     set GRADLE_HOME_BIN=%LOCALAPPDATA%\Temp\opencode\gradle-8.0.1\bin
if not defined EXPO_PUBLIC_API_URL set EXPO_PUBLIC_API_URL=http://10.90.175.247:3000/api
set CI=1

rem --- Garde JDK 17 ----------------------------------------------------------
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo [ERREUR] JDK 17 introuvable dans JAVA_HOME="%JAVA_HOME%"
  echo [ERREUR] Definir JAVA_HOME vers un JDK 17 - cf. BUILD_FIX_GUIDE.md pre-requis.
  exit /b 1
)
set JVER=
for /f "tokens=3" %%v in ('"%JAVA_HOME%\bin\java.exe" -version 2^>^&1') do if not defined JVER set JVER=%%v
if not "%JVER:~1,2%"=="17" (
  echo [ERREUR] JDK 17 requis pour Gradle 8.0.1 - version detectee : %JVER% ^(JAVA_HOME="%JAVA_HOME%"^)
  echo [ERREUR] Definir JAVA_HOME vers un JDK 17 - cf. BUILD_FIX_GUIDE.md pre-requis.
  exit /b 1
)

rem --- Garde Android SDK -----------------------------------------------------
if not exist "%ANDROID_HOME%\platform-tools\adb.exe" (
  echo [ERREUR] Android SDK introuvable dans ANDROID_HOME="%ANDROID_HOME%"
  exit /b 1
)
if not exist "%ANDROID_NDK_HOME%" (
  echo [ERREUR] NDK 26.3.11579264 introuvable dans ANDROID_NDK_HOME="%ANDROID_NDK_HOME%"
  echo [ERREUR] Installer via sdkmanager : "ndk;26.3.11579264"
  exit /b 1
)

rem --- Gradle : local 8.0.1, sinon fallback wrapper ---------------------------
set GRADLE_CMD=%GRADLE_HOME_BIN%\gradle.bat
if not exist "%GRADLE_CMD%" (
  if exist "android\gradlew.bat" (
    echo [INFO] Gradle local absent - fallback gradlew.bat - wrapper 8.0.1
    set GRADLE_CMD=android\gradlew.bat
  ) else (
    echo [ERREUR] Gradle 8.0.1 introuvable : "%GRADLE_CMD%"
    exit /b 1
  )
)

rem --- PATH ------------------------------------------------------------------
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
if exist "C:\Program Files\nodejs\node.exe" set PATH=C:\Program Files\nodejs;%PATH%

rem --- Build -----------------------------------------------------------------
echo [%date% %time%] GRADLE 8.0.1 BUILD START ^| JAVA_HOME=%JAVA_HOME% > build-gradle.log
echo [%date% %time%] API=%EXPO_PUBLIC_API_URL% >> build-gradle.log
call "%GRADLE_CMD%" --no-daemon --stacktrace -p android :app:assembleRelease >> build-gradle.log 2>&1
set BUILD_ERR=%errorlevel%
echo [%date% %time%] GRADLE exitcode %BUILD_ERR% >> build-gradle.log
echo [%date% %time%] DONE >> build-gradle.log
exit /b %BUILD_ERR%