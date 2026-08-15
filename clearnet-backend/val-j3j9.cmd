@echo off
set TSP=%date% %time%
echo [%TSP%] BACKEND BUILD+TESTS J3J5+J9J10 START >> val-j3j9.log
call npm run build >> val-j3j9.log 2>&1
echo [%date% %time%] BUILD exitcode %errorlevel% >> val-j3j9.log
call node node_modules\jest\bin\jest.js --runInBand --verbose >> val-j3j9.log 2>&1
echo [%date% %time%] TESTS exitcode %errorlevel% >> val-j3j9.log
echo [%date% %time%] DONE >> val-j3j9.log