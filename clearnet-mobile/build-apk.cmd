@echo off
setlocal
cd /d "%~dp0"
set ANDROID_HOME=C:\Users\deral\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=C:\Users\deral\AppData\Local\Android\Sdk
set EXPO_PUBLIC_API_URL=http://10.90.175.247:3000/api
echo [%date% %time%] APK BUILD START > build-apk.log
call npx expo prebuild --platform android >> build-apk.log 2>&1
echo [%date% %time%] PREBUILD exitcode %errorlevel% >> build-apk.log
if exist android\android\gradlew.bat ( set GRADLE_DIR=android\android ) else ( set GRADLE_DIR=android )
call "%GRADLE_DIR%\gradlew.bat" -p "%GRADLE_DIR%" assembleRelease >> build-apk.log 2>&1
echo [%date% %time%] GRADLE exitcode %errorlevel% >> build-apk.log
echo [%date% %time%] DONE >> build-apk.log