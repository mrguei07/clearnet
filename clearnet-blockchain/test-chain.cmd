@echo off
echo [%date% %time%] HARDHAT COMPILE+TEST START >> test-chain.log
call npx hardhat compile >> test-chain.log 2>&1
echo [%date% %time%] COMPILE exitcode %errorlevel% >> test-chain.log
call npx hardhat test >> test-chain.log 2>&1
echo [%date% %time%] TESTS exitcode %errorlevel% >> test-chain.log
echo [%date% %time%] DONE >> test-chain.log